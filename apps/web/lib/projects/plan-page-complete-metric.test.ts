import { roomArchitectureFromPlan } from '@uyut/ai'
import type { PlanGeometry, PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { inspectManualPlanCompleteness } from './plan-geometry-inspection'
import { planPageMetricDraft } from './plan-page-metric-draft'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

const allNumbers = [1, 2, 3, 4, 5, 6, 7, 8]

/** Strip QA observations: only exact source vertices and declared openings enter production. */
function completeSheet() {
  const source = {
    sha256: page.source.sha256,
    pdfPage: page.source.pdfPage,
    state: 'existing' as const,
  }
  const contours: PlanPageContours = {
    source: { ...source },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    exterior: { polygon: structuredClone(page.apartmentEnvelope.polygon) },
    rooms: page.rooms.map((room) => ({
      ...(room.roomSourceNumbers
        ? { roomSourceNumbers: [...room.roomSourceNumbers] }
        : { roomSourceNumber: room.roomSourceNumber as number }),
      polygon: structuredClone(room.polygon),
      openings: room.openings.map(({ id, kind, wallEdgeIndex, start, end }) => ({
        id,
        kind: kind as 'door' | 'window' | 'balcony',
        wallEdgeIndex,
        start: { ...start },
        end: { ...end },
      })),
    })),
  }
  const linework: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    paths: structuredClone(page.nativePaths) as PdfVectorPath[],
    ...page.nativeLayer,
  }
  // Original indexes are retained; omitted address/title items cannot shift evidence indexes.
  const labels = Array.from({ length: 192 }, () => ({ text: '', x: 0, y: 0, rotation: 0 }))
  for (const { index, ...label } of page.nativeLabels) labels[index] = { ...label }
  const reading: PlanReading = {
    readAt: '2026-09-28T00:00:00.000Z',
    sourcePage: 6,
    planState: 'existing',
    rooms: [
      { sourceNumber: 1, name: 'Прихожая', kind: 'living', utility: true },
      { sourceNumber: 2, name: 'Кухня', kind: 'kitchen' },
      { sourceNumber: 3, name: 'Гостиная', kind: 'living' },
      {
        sourceNumber: 4,
        name: 'Спальня 4',
        kind: 'bedroom',
        widthCm: 298.5,
        depthCm: 515.6,
        measurementEvidence: {
          width: {
            kind: 'horizontal-chain',
            scope: 'room',
            sourceNumber: 4,
            complete: true,
            segmentsMm: [939, 1344, 702],
            textItemIndexes: [55, 56, 57],
          },
          depth: {
            kind: 'vertical-chain',
            scope: 'room',
            sourceNumber: 4,
            complete: true,
            segmentsMm: [5156],
            textItemIndexes: [62],
          },
        },
      },
      { sourceNumber: 5, name: 'Коридор', kind: 'living', utility: true },
      { sourceNumber: 6, name: 'Спальня 6', kind: 'bedroom', widthCm: 294.5, depthCm: 415.4 },
      { sourceNumber: 7, name: 'Ванная', kind: 'bath' },
      { sourceNumber: 8, name: 'Санузел', kind: 'bath' },
    ],
  }
  return {
    reading,
    labels,
    context: {
      source,
      contours,
      linework,
      planText: JSON.stringify(labels),
      calibrationRoomNumbers: [4],
    },
  }
}

function draft(fixture = completeSheet(), numbers = allNumbers): PlanGeometry {
  const result = planPageMetricDraft(fixture.reading, fixture.context, numbers)
  expect(result.ok, result.ok ? '' : result.error).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

describe('complete existing PDF page in one native metric scale', () => {
  it('retains seven physical zones covering eight source numbers without changing readings', () => {
    const fixture = completeSheet()
    const before = structuredClone(fixture)
    const geometry = draft(fixture)
    expect(geometry.rooms).toHaveLength(7)
    expect(
      geometry.rooms.flatMap((room) => room.sourceNumbers ?? [room.sourceNumber]).sort(),
    ).toEqual(allNumbers)
    expect(geometry).toMatchObject({ source: 'manual', status: 'draft' })
    expect(geometry).not.toHaveProperty('confirmedAt')
    expect(geometry.pdfCalibration).toMatchObject({
      sourceSha256: page.source.sha256,
      pdfPage: 6,
      anchorRoomNumbers: [4],
      labelIndexes: [55, 56, 57, 62],
    })
    expect(geometry.pdfCalibration?.cmPerPoint).toBeCloseTo(1.7638869966, 8)
    expect(inspectManualPlanCompleteness(geometry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-pdf-opening-measurements' }),
        expect.objectContaining({
          id: 'manual-disconnected-walls',
          message: expect.stringContaining('не соединяйте грани произвольными линиями'),
        }),
      ]),
    )
    expect(fixture).toEqual(before)
    expect(fixture.reading.rooms.find((room) => room.sourceNumber === 2)).not.toHaveProperty(
      'widthCm',
    )
  })

  it('selects either hallway label as the same whole zone, not two invented rectangles', () => {
    const first = draft(completeSheet(), [1])
    const fifth = draft(completeSheet(), [5])
    expect(first).toEqual(fifth)
    expect(first.rooms).toHaveLength(1)
    expect(first.rooms[0]).toMatchObject({ sourceNumbers: [1, 5], name: 'Прихожая / Коридор' })
    expect(first.rooms[0]).not.toHaveProperty('sourceNumber')
  })

  it('projects every native notch and exterior vertex isotropically, including short reveals', () => {
    const fixture = completeSheet()
    const geometry = draft(fixture)
    const calibration = geometry.pdfCalibration
    if (!calibration) throw new Error('Missing PDF calibration')
    const project = (point: { x: number; y: number }) => ({
      xCm:
        Math.round(
          ((point.x - calibration.origin.x) * page.pageWidth * calibration.cmPerPoint) / 100,
        ) / 10,
      yCm:
        Math.round(
          ((point.y - calibration.origin.y) * page.pageHeight * calibration.cmPerPoint) / 100,
        ) / 10,
    })
    for (const contour of fixture.context.contours.rooms) {
      const room = geometry.rooms.find((room) =>
        contour.roomSourceNumbers
          ? room.sourceNumbers?.join(',') === contour.roomSourceNumbers.join(',')
          : room.sourceNumber === contour.roomSourceNumber,
      )
      expect(room?.polygon).toEqual(contour.polygon.map(project))
    }
    const outer = geometry.walls.filter((wall) => wall.kind === 'outer')
    expect(outer).toHaveLength(18)
    expect(outer.map((wall) => wall.start)).toEqual(page.apartmentEnvelope.polygon.map(project))
    expect(geometry.walls).toHaveLength(63)
    const bedroom = geometry.rooms.find((room) => room.sourceNumber === 6)
    expect(bedroom?.polygon).toHaveLength(8)
    expect(geometry.rooms.find((room) => room.sourceNumber === 8)?.polygon).toHaveLength(6)
    const shortEdges = geometry.walls.filter(
      (wall) => Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm) < 20,
    )
    expect(shortEdges.length).toBeGreaterThanOrEqual(3)
    expect(fixture.reading.rooms.find((room) => room.sourceNumber === 6)?.depthCm).toBe(415.4)
  })

  it('retains all seventeen annotated openings without invented heights or swing zones', () => {
    const fixture = completeSheet()
    const geometry = draft(fixture)
    expect(geometry.openings).toHaveLength(17)
    expect(new Set(geometry.openings.map((opening) => opening.id)).size).toBe(17)
    for (const id of geometry.pdfCalibration?.derivedOpeningIds ?? [])
      expect(geometry.openings.some((opening) => opening.id === id)).toBe(true)
    for (const opening of geometry.openings) {
      expect(opening).not.toHaveProperty('clearance')
      expect(opening).not.toHaveProperty('sillHeightCm')
      expect(geometry.walls.some((wall) => wall.id === opening.wallId)).toBe(true)
    }
    // This is complete annotation transfer, not a claim all visible source openings were resolved.
    expect(page.unresolvedFeatures.length).toBeGreaterThan(0)
    expect(geometry.warnings.join(' ')).toContain('Неразмеченные')
    expect(roomLayoutInputFromGeometry(geometry, 'Спальня 6', null)).toBeNull()
    expect(roomArchitectureFromPlan(geometry, 'Спальня 6')).toBeNull()
  })

  it('never stretches the stepped bedroom to its shorter printed body measurement', () => {
    const geometry = draft()
    geometry.status = 'confirmed' // Controlled downstream test, not an actual human review.
    if (geometry.pdfCalibration) geometry.pdfCalibration.derivedOpeningIds = []
    const room = geometry.rooms.find((room) => room.sourceNumber === 6)
    if (!room) throw new Error('Missing stepped bedroom')
    const minX = Math.min(...room.polygon.map((point) => point.xCm))
    const minY = Math.min(...room.polygon.map((point) => point.yCm))
    const depth = Math.max(...room.polygon.map((point) => point.yCm)) - minY
    const input = roomLayoutInputFromGeometry(geometry, room.name, {
      widthCm: 294.5,
      depthCm: 415.4,
    })
    expect(input).not.toBeNull()
    expect(depth).toBeCloseTo(422.9, 1)
    expect(input?.depthCm).toBe(depth)
    expect(input?.floorPolygon).toEqual(
      room.polygon.map((point) => ({ xCm: point.xCm - minX, yCm: point.yCm - minY })),
    )
    expect(input?.missingSafetyData.some((warning) => warning.includes('415.4'))).toBe(true)
    expect(roomArchitectureFromPlan(geometry, room.name)?.shape).toBe('nonrectangular')
  })

  it('does not offer individual furniture placement for either label of a shared physical zone', () => {
    const geometry = draft()
    geometry.status = 'confirmed'
    if (geometry.pdfCalibration) geometry.pdfCalibration.derivedOpeningIds = []
    for (const name of ['Прихожая', 'Коридор', 'Прихожая / Коридор']) {
      expect(roomLayoutInputFromGeometry(geometry, name, null)).toBeNull()
      expect(roomArchitectureFromPlan(geometry, name)).toBeNull()
    }
  })

  it('retains an unlabelled interval as derived and blocks consumers even after status changes', () => {
    const fixture = completeSheet()
    // Remove one actual printed opening label, without altering vectors or room anchors.
    fixture.labels[84] = { text: '', x: 0, y: 0, rotation: 0 }
    fixture.context.planText = JSON.stringify(fixture.labels)
    const geometry = draft(fixture)
    expect(geometry.openings).toHaveLength(17)
    expect(geometry.pdfCalibration?.derivedOpeningIds.length).toBeGreaterThan(0)
    geometry.status = 'confirmed'
    expect(roomLayoutInputFromGeometry(geometry, 'Спальня 6', null)).toBeNull()
    expect(roomArchitectureFromPlan(geometry, 'Спальня 6')).toBeNull()
  })

  it.each([[], [4, 4], [99], [1], [4.5]].map((anchors) => ({ anchors })))(
    'rejects invalid or grouped scale anchors $anchors',
    ({ anchors }) => {
      const fixture = completeSheet()
      fixture.context.calibrationRoomNumbers = anchors
      expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers).ok).toBe(false)
    },
  )

  it('requires both anchor chains and refuses different directional scale beyond the existing tolerance', () => {
    const fixture = completeSheet()
    const anchor = fixture.reading.rooms.find((room) => room.sourceNumber === 4)
    if (!anchor?.measurementEvidence?.depth) throw new Error('Missing anchor evidence')
    anchor.depthCm = 520
    anchor.measurementEvidence.depth.segmentsMm = [5200]
    const label = fixture.labels[62]
    if (!label) throw new Error('Missing native depth label')
    fixture.labels[62] = { ...label, text: '5200' }
    fixture.context.planText = JSON.stringify(fixture.labels)
    expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers)).toMatchObject({
      ok: false,
      error: expect.stringContaining('единый масштаб'),
    })
    delete anchor.measurementEvidence.depth
    expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers).ok).toBe(false)
  })

  it('rejects stale or proposed sources and non-native room or exterior vertices', () => {
    const mutations: Array<(fixture: ReturnType<typeof completeSheet>) => void> = [
      (fixture) => {
        fixture.context.source.sha256 = 'a'.repeat(64)
      },
      (fixture) => {
        fixture.context.source.pdfPage = 7
      },
      (fixture) => {
        fixture.reading.planState = 'proposed'
      },
      (fixture) => {
        const point = fixture.context.contours.rooms[0]?.polygon[0]
        if (point) point.x += 0.01
      },
      (fixture) => {
        const point = fixture.context.contours.exterior?.polygon[0]
        if (point) point.x += 0.01
      },
    ]
    for (const mutate of mutations) {
      const fixture = completeSheet()
      mutate(fixture)
      expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers).ok).toBe(false)
    }
  })

  it('rejects duplicated group membership and collisions with a separately claimed source number', () => {
    const fixture = completeSheet()
    const group = fixture.context.contours.rooms.find((room) => room.roomSourceNumbers)
    if (!group?.roomSourceNumbers) throw new Error('Missing shared zone')
    group.roomSourceNumbers = [1, 1]
    expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers).ok).toBe(false)
    group.roomSourceNumbers = [1, 5]
    fixture.context.contours.rooms.push({
      roomSourceNumber: 5,
      polygon: structuredClone(group.polygon),
    })
    expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers).ok).toBe(false)
  })

  it('does not convert unknown individual dimensions into evidence in the legacy strict path', () => {
    const fixture = completeSheet()
    const { calibrationRoomNumbers: _anchors, ...strictContext } = fixture.context
    expect(planPageMetricDraft(fixture.reading, strictContext, allNumbers).ok).toBe(false)
    expect(draft(fixture).rooms).toHaveLength(7)
  })
})
