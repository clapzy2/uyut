import { roomArchitectureFromPlan } from '@uyut/ai'
import type { PlanGeometry, PlanPageContours, PlanPageOpening, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { inspectDoorAdjacency } from './plan-door-adjacency'
import { inspectManualPlanCompleteness } from './plan-geometry-inspection'
import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
  currentWallFacePairs,
} from './plan-opening-face-pairs'
import { verifyPlanPageOpenings } from './plan-page-feature-checks'
import { planPageGeometryElementId, planPageMetricDraft } from './plan-page-metric-draft'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { pdfContourKey } from './plan-pdf-room-binding'
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
      openings: room.openings.map((opening) => ({
        id: opening.id,
        kind: opening.kind as 'door' | 'window' | 'balcony',
        wallEdgeIndex: opening.wallEdgeIndex,
        start: { ...opening.start },
        end: { ...opening.end },
        ...('endpointProofs' in opening
          ? {
              endpointProofs: structuredClone(
                opening.endpointProofs,
              ) as PlanPageOpening['endpointProofs'],
            }
          : {}),
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
  it('сохраняет концы дверей напрямую из исходной разметки, включая общий порог', () => {
    const fixture = completeSheet()
    const geometry = draft(fixture)
    const calibration = geometry.pdfCalibration
    if (!calibration) throw new Error('Нет калибровки PDF')
    const convert = (point: { x: number; y: number }) => ({
      xCm:
        Math.round(
          ((point.x - calibration.origin.x) *
            fixture.context.linework.pageWidth *
            calibration.cmPerPoint) /
            100,
        ) / 10,
      yCm:
        Math.round(
          ((point.y - calibration.origin.y) *
            fixture.context.linework.pageHeight *
            calibration.cmPerPoint) /
            100,
        ) / 10,
    })
    const expected = new Map(
      fixture.context.contours.rooms.flatMap((room) =>
        (room.openings ?? []).map(
          (opening) =>
            [
              planPageGeometryElementId(
                fixture.context.source,
                pdfContourKey(room),
                'opening',
                opening.id,
              ),
              [convert(opening.start), convert(opening.end)],
            ] as const,
        ),
      ),
    )
    for (const pair of calibration.openingFacePairs ?? []) {
      for (const binding of pair.bindings)
        expect(binding.cut).toEqual(expected.get(binding.opening.id))
    }
    for (const proof of calibration.openingWidthProofs ?? []) {
      expect(proof.cut).toEqual(expected.get(proof.opening.id))
      if (proof.oppositeBinding)
        expect(proof.oppositeBinding.cut).toEqual(expected.get(proof.oppositeBinding.opening.id))
    }
    expect(calibration.sourceOpeningFacePairs).toEqual(calibration.openingFacePairs)
  })

  it('передаёт реальный PDF-черновик в расчёт без подмены его граней осями', () => {
    const geometry = draft()
    const entry = geometry.pdfCalibration?.openingWidthProofs?.find(
      (proof) =>
        proof.opening.id ===
        planPageGeometryElementId(
          completeSheet().context.source,
          '1+5',
          'opening',
          'zone-1-5-entrance',
        ),
    )
    if (!entry) throw new Error('Нет исходного входного проёма')
    const opening = geometry.openings.find((opening) => opening.id === entry.opening.id)
    if (!opening) throw new Error('Нет стартовой двери')
    opening.clearance = { side: 'left', depthCm: 100, shape: 'rectangle' }
    geometry.routeStartOpeningId = opening.id
    geometry.routeWidthCm = 70
    const review = inspectPdfClearanceRoutes(geometry)
    expect(review.missing).toBeUndefined()
    expect(review.result?.status).toBe('constructive-routes')
    expect(review.result?.routes).toHaveLength(7)
    expect(review.result?.unresolvedRoomIds).toEqual([])
    expect(geometry.status).toBe('draft')
  })
  it('groups rooms connected by unchanged door faces or the proven common threshold', () => {
    const geometry = draft()
    const review = inspectDoorAdjacency(geometry)
    expect(review.links).toHaveLength(6)
    expect(review.unresolvedFacePairCount).toBe(0)
    const sourceNumbers = review.provenGroups.map((group) =>
      group.map(
        (index) => geometry.rooms[index]?.sourceNumbers ?? geometry.rooms[index]?.sourceNumber,
      ),
    )
    expect(sourceNumbers).toEqual([[[1, 5], 2, 3, 4, 6, 7, 8]])
  })

  it('recognizes the common threshold without a false second wall-face pair', () => {
    const geometry = draft()
    if (!geometry.pdfCalibration) throw new Error('Missing PDF calibration')
    geometry.pdfCalibration.openingFacePairs = []
    const review = inspectDoorAdjacency(geometry)
    expect(review.links).toEqual([expect.objectContaining({ roomIndexes: [0, 4] })])
    expect(review.provenGroups).toHaveLength(geometry.rooms.length - 1)
  })

  it('does not infer a passage from touching contours without either source proof', () => {
    const geometry = draft()
    if (!geometry.pdfCalibration) throw new Error('Missing PDF calibration')
    geometry.pdfCalibration.openingFacePairs = []
    geometry.pdfCalibration.openingWidthProofs = []
    const review = inspectDoorAdjacency(geometry)
    expect(review.links).toEqual([])
    expect(review.provenGroups).toHaveLength(geometry.rooms.length)
  })

  it('withdraws an adjacency when a source-backed door is edited', () => {
    const geometry = draft()
    const first = geometry.pdfCalibration?.openingFacePairs?.[0]
    if (!first) throw new Error('Missing door face pair')
    const opening = geometry.openings.find((value) => value.id === first.bindings[0].opening.id)
    if (!opening) throw new Error('Missing paired opening')
    opening.widthCm += 1
    const review = inspectDoorAdjacency(geometry)
    expect(review.links).toHaveLength(5)
    expect(review.unresolvedFacePairCount).toBe(1)
  })

  it('withdraws the shared-threshold link after an opening edit or mismatched cut', () => {
    const geometry = draft()
    if (!geometry.pdfCalibration) throw new Error('Missing PDF calibration')
    geometry.pdfCalibration.openingFacePairs = []
    const proof = geometry.pdfCalibration.openingWidthProofs?.find((item) => item.sameOpeningAs)
    if (!proof) throw new Error('Missing common-threshold source proof')
    const opening = geometry.openings.find((item) => item.id === proof.opening.id)
    if (!opening) throw new Error('Missing shared opening')
    opening.offsetCm += 1
    expect(inspectDoorAdjacency(geometry).links).toEqual([])

    opening.offsetCm = proof.opening.offsetCm
    proof.opening.offsetCm += 1
    opening.offsetCm += 1
    expect(inspectDoorAdjacency(geometry).links).toEqual([])
  })

  it('does not assign a door face to a room without an exact boundary owner', () => {
    const geometry = draft()
    const pair = geometry.pdfCalibration?.openingFacePairs?.[0]
    if (!pair || !geometry.pdfCalibration) throw new Error('Missing door face pair')
    geometry.pdfCalibration.openingFacePairs = [pair]
    geometry.pdfCalibration.openingWidthProofs = []
    const host = pair.bindings[0].wall
    const ownerIndex = geometry.rooms.findIndex(
      (room) =>
        room.polygon.some(
          (point) => point.xCm === host.start.xCm && point.yCm === host.start.yCm,
        ) && room.polygon.some((point) => point.xCm === host.end.xCm && point.yCm === host.end.yCm),
    )
    if (ownerIndex < 0) throw new Error('Missing host owner')
    const owner = geometry.rooms[ownerIndex]
    if (!owner) throw new Error('Missing host owner room')
    owner.polygon = owner.polygon.map((point) => ({ ...point, xCm: point.xCm + 1 }))
    geometry.pdfCalibration.wallFaceRoomPolygons = geometry.rooms.map((room) =>
      structuredClone(room.polygon),
    )
    expect(currentOpeningFacePairs(geometry)).toHaveLength(1)
    const review = inspectDoorAdjacency(geometry)
    expect(review.links).toEqual([])
    expect(review.unresolvedFacePairCount).toBe(1)
  })

  it('does not count ambiguous face ownership or a balcony opening as an interior door', () => {
    const geometry = draft()
    const pair = geometry.pdfCalibration?.openingFacePairs?.[0]
    if (!pair || !geometry.pdfCalibration) throw new Error('Missing door face pair')
    geometry.pdfCalibration.openingFacePairs = [pair]
    geometry.pdfCalibration.openingWidthProofs = []
    const owner = geometry.rooms.find((room) =>
      room.polygon.some(
        (point) =>
          point.xCm === pair.bindings[0].wall.start.xCm &&
          point.yCm === pair.bindings[0].wall.start.yCm,
      ),
    )
    if (!owner) throw new Error('Missing face owner')
    geometry.rooms.push({ name: 'Дублирующий контур', polygon: structuredClone(owner.polygon) })
    geometry.pdfCalibration.wallFaceRoomPolygons = geometry.rooms.map((room) =>
      structuredClone(room.polygon),
    )
    expect(currentOpeningFacePairs(geometry)).toHaveLength(1)
    expect(inspectDoorAdjacency(geometry)).toMatchObject({ links: [], unresolvedFacePairCount: 1 })

    geometry.rooms.pop()
    geometry.pdfCalibration.wallFaceRoomPolygons = geometry.rooms.map((room) =>
      structuredClone(room.polygon),
    )
    const opening = geometry.openings.find((item) => item.id === pair.bindings[0].opening.id)
    if (!opening) throw new Error('Missing paired door')
    opening.type = 'balcony'
    pair.bindings[0].opening.type = 'balcony'
    expect(currentOpeningFacePairs(geometry)).toHaveLength(1)
    expect(inspectDoorAdjacency(geometry)).toMatchObject({ links: [], unresolvedFacePairCount: 1 })
  })

  it('checks separate kitchen spans against printed 563 and 926 mm dimensions', () => {
    const fixture = completeSheet()
    const checks = verifyPlanPageOpenings(
      fixture.context.linework,
      fixture.context.source,
      fixture.context.contours,
      fixture.context.planText,
    )
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ openingId: 'room-2-window', status: 'candidate', widthMm: 563 }),
        expect.objectContaining({ openingId: 'room-2-balcony', status: 'candidate', widthMm: 926 }),
      ]),
    )
    const geometry = draft(fixture)
    expect(geometry.openings.filter((opening) => opening.type === 'window')).toHaveLength(5)
    expect(geometry.openings.filter((opening) => opening.type === 'balcony')).toHaveLength(1)
    expect(geometry.pdfCalibration?.derivedOpeningIds).toHaveLength(0)
  })

  it.each(['missing-proof', 'wrong-path', 'moved-point'] as const)(
    'rejects kitchen crossing tampering: %s',
    (mode) => {
      const fixture = completeSheet()
      const opening = fixture.context.contours.rooms
        .find((room) => room.roomSourceNumber === 2)
        ?.openings?.find((value) => value.id === 'room-2-window')
      if (!opening) throw new Error('Missing kitchen window')
      if (mode === 'missing-proof') delete opening.endpointProofs
      if (mode === 'wrong-path' && opening.endpointProofs?.end)
        opening.endpointProofs.end.operationIndex = 572
      if (mode === 'moved-point') opening.end.x += 0.001
      expect(planPageMetricDraft(fixture.reading, fixture.context, allNumbers).ok).toBe(false)
    },
  )

  it('keeps only unchanged server-derived pairs after a host or opening edit', () => {
    const geometry = draft()
    expect(currentOpeningFacePairs(geometry)).toHaveLength(5)
    const first = geometry.pdfCalibration?.openingFacePairs?.[0]
    if (!first) throw new Error('Missing face pair')
    const opening = geometry.openings.find((value) => value.id === first.bindings[0].opening.id)
    if (!opening) throw new Error('Missing paired opening')
    opening.widthCm += 1
    expect(currentOpeningFacePairs(geometry)).not.toContain(first)
    opening.widthCm -= 1
    const wall = geometry.walls.find((value) => value.id === opening.wallId)
    if (!wall) throw new Error('Missing paired host')
    wall.start.xCm += 1
    expect(currentOpeningFacePairs(geometry)).not.toContain(first)
  })

  it.each(['moved-point', 'removed-room', 'missing-snapshot'] as const)(
    'invalidates opening face evidence when source room interiors change: %s',
    (mode) => {
      const geometry = draft()
      expect(currentOpeningFacePairs(geometry)).toHaveLength(5)
      if (mode === 'moved-point') {
        const point = geometry.rooms[0]?.polygon[0]
        if (!point) throw new Error('Missing source contour')
        point.xCm += 1
      }
      if (mode === 'removed-room') geometry.rooms.pop()
      if (mode === 'missing-snapshot' && geometry.pdfCalibration)
        delete geometry.pdfCalibration.wallFaceRoomPolygons
      expect(currentOpeningFacePairs(geometry)).toEqual([])
    },
  )

  it('preserves opening face evidence when unchanged rooms are reordered', () => {
    const geometry = draft()
    geometry.rooms.reverse()
    expect(currentOpeningFacePairs(geometry)).toHaveLength(5)
  })

  it('binds all printed opening widths to the unchanged source cuts and contours', () => {
    const geometry = draft()
    const proofs = geometry.pdfCalibration?.openingWidthProofs
    expect(proofs).toHaveLength(19)
    expect(currentOpeningWidthProofs(geometry)).toHaveLength(19)

    const transferred = proofs?.find((proof) => proof.sameOpeningAs)
    if (!transferred?.oppositeBinding) throw new Error('Missing opposite opening proof')
    expect(transferred.labelIndex).toBe(84)
    expect(transferred.oppositeBinding.opening.widthCm).toBeCloseTo(90.3)

    const donor = geometry.openings.find(
      (opening) => opening.id === transferred.oppositeBinding?.opening.id,
    )
    if (!donor) throw new Error('Missing donor opening')
    donor.widthCm += 1
    expect(currentOpeningWidthProofs(geometry)).not.toContain(transferred)
    donor.widthCm -= 1

    const recipient = geometry.openings.find((opening) => opening.id === transferred.opening.id)
    if (!recipient) throw new Error('Missing receiving opening')
    recipient.offsetCm += 1
    expect(currentOpeningWidthProofs(geometry)).not.toContain(transferred)
    recipient.offsetCm -= 1

    const wall = geometry.walls.find((item) => item.id === transferred.wall.id)
    if (!wall) throw new Error('Missing receiving wall')
    wall.end.xCm += 1
    expect(currentOpeningWidthProofs(geometry)).not.toContain(transferred)
    wall.end.xCm -= 1

    const point = geometry.rooms[0]?.polygon[0]
    if (!point) throw new Error('Missing source contour')
    point.xCm += 1
    expect(currentOpeningWidthProofs(geometry)).toEqual([])
  })

  it('stores source interval relations without claiming construction thickness or completing topology', () => {
    const geometry = draft()
    expect(currentWallFacePairs(geometry)).toHaveLength(52)
    expect(geometry.walls.every((wall) => wall.thicknessCm === undefined)).toBe(true)
    expect(inspectManualPlanCompleteness(geometry)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
    )
    for (const pair of geometry.pdfCalibration?.wallFacePairs ?? []) {
      expect(pair.faces[0].nativeSegment.operationIndex).toBe(
        pair.faces[1].nativeSegment.operationIndex,
      )
      expect(pair.faces[0].nativeSegment.subpathIndex).toBe(
        pair.faces[1].nativeSegment.subpathIndex,
      )
    }
  })

  it.each(['host-edit', 'added-cut', 'removed-cut', 'widened-cut'] as const)(
    'invalidates saved boundary relations after %s',
    (mode) => {
      const geometry = draft()
      const pair = geometry.pdfCalibration?.wallFacePairs?.find(
        (value) => value.openings.length > 0,
      )
      if (!pair) throw new Error('Missing wall interval relation with cuts')
      const wall = geometry.walls.find((value) => value.id === pair.faces[0].wall.id)
      const cut = geometry.openings.find((value) => value.id === pair.openings[0]?.id)
      if (!wall || !cut) throw new Error('Missing current host or cut')
      if (mode === 'host-edit') wall.end.xCm += 1
      if (mode === 'added-cut') geometry.openings.push({ ...cut, id: 'new-cut', wallId: wall.id })
      if (mode === 'removed-cut')
        geometry.openings = geometry.openings.filter((value) => value.id !== cut.id)
      if (mode === 'widened-cut') cut.widthCm += 1
      expect(currentWallFacePairs(geometry)).not.toContainEqual(pair)
    },
  )

  it('keeps boundary relations after unrelated edits or opening metadata changes', () => {
    const geometry = draft()
    const pair = geometry.pdfCalibration?.wallFacePairs?.find((value) => value.openings.length > 0)
    if (!pair) throw new Error('Missing wall interval relation')
    const cut = geometry.openings.find((value) => value.id === pair.openings[0]?.id)
    if (!cut) throw new Error('Missing current cut')
    cut.sillHeightCm = 80
    const room = geometry.rooms[0]
    if (!room) throw new Error('Missing room')
    room.name = 'Новое название'
    geometry.openings.reverse()
    geometry.rooms.reverse()
    expect(currentWallFacePairs(geometry)).toContainEqual(pair)
  })

  it('invalidates boundary relations when free-floor contours change', () => {
    const geometry = draft()
    const vertex = geometry.rooms[0]?.polygon[0]
    if (!vertex) throw new Error('Missing room vertex')
    vertex.xCm += 1
    expect(currentWallFacePairs(geometry)).toEqual([])
  })
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
    expect(geometry.footprint).toEqual(page.apartmentEnvelope.polygon.map(project))
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

  it('keeps an outside wall envelope separate from the floor boundary', () => {
    const fixture = completeSheet()
    if (!fixture.context.contours.exterior) throw new Error('Missing reviewed exterior')
    fixture.context.contours.exterior.boundaryRole = 'outer-wall-envelope'

    const geometry = draft(fixture)
    expect(geometry.footprint).toBeUndefined()
    expect(geometry.walls.filter((wall) => wall.kind === 'outer')).toHaveLength(18)
    expect(geometry.pdfCalibration?.exteriorBoundaryRole).toBe('outer-wall-envelope')
    expect(inspectManualPlanCompleteness(geometry)).toContainEqual(
      expect.objectContaining({ id: 'manual-missing-floor-boundary', severity: 'error' }),
    )
  })

  it('retains all nineteen annotated openings without invented heights or swing zones', () => {
    const fixture = completeSheet()
    const geometry = draft(fixture)
    expect(geometry.openings).toHaveLength(19)
    expect(new Set(geometry.openings.map((opening) => opening.id)).size).toBe(19)
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
    fixture.labels[36] = { text: '', x: 0, y: 0, rotation: 0 }
    fixture.context.planText = JSON.stringify(fixture.labels)
    const geometry = draft(fixture)
    expect(geometry.openings).toHaveLength(19)
    expect(geometry.pdfCalibration?.derivedOpeningIds).toHaveLength(1)
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
