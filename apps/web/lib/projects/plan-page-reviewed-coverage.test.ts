import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { inspectReviewedPageCoverage } from './plan-page-reviewed-coverage'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function sample() {
  const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const polygon = [
    { x: 10, y: 10 },
    { x: 100, y: 10 },
    { x: 100, y: 100 },
    { x: 10, y: 100 },
  ]
  const contours: PlanPageContours = {
    source: { ...source },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [{ roomSourceNumber: 1, polygon }],
  }
  const linework: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [{ operationIndex: 1, subpathIndex: 0, paint: 'stroke', closed: true, points: polygon }],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  const reading: PlanReading = {
    readAt: '2026-10-09',
    sourcePage: 1,
    planState: 'existing',
    rooms: [{ sourceNumber: 1, name: 'Комната', kind: 'living' }],
  }
  return { source, contours, linework, reading }
}

describe('same-source reviewed coverage without promoting an apartment', () => {
  it('checks physical rooms beside held source paint without counting a shared floor', () => {
    const input = sample()
    const sourcePolygon = [
      { x: 200, y: 10 },
      { x: 290, y: 10 },
      { x: 290, y: 100 },
      { x: 200, y: 100 },
    ]
    input.contours.rooms.push({
      roomSourceNumber: 2,
      polygon: sourcePolygon,
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: 'source-floor-2',
        exactPointKeys: ['200/1:10/1', '290/1:10/1', '290/1:100/1', '200/1:100/1'],
        holes: [],
        holeExactPointKeys: [],
      },
    })
    input.reading.rooms.push({ sourceNumber: 2, name: 'Балкон', kind: 'living', utility: true })
    const envelope = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 110 },
      { x: 0, y: 110 },
    ]
    input.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
    input.contours.floor = { polygon: envelope }
    const before = structuredClone(input)

    const report = inspectReviewedPageCoverage(input)

    expect(report.status, report.refusalReason).toBe('partial')
    expect(report.missingSourceNumbers).toEqual([])
    expect(report.wallSpans.unmatched).toBe(4)
    expect(report.floorBoundary).toBe('missing')
    expect(report.issues).toContain('source-areas-held')
    expect(report.issues).toContain('floor-boundary-missing')
    expect(report.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)

    input.source.sha256 = 'b'.repeat(64)
    expect(inspectReviewedPageCoverage(input).status).toBe('refused')
  })

  it('shows no physical evidence when every saved room is only a source-paint guide', () => {
    const input = sample()
    const room = input.contours.rooms[0]
    if (!room) throw new Error('Missing source coverage fixture')
    room.sourceTopology = {
      kind: 'unclassified-source-paint',
      floorId: 'source-floor-1',
      exactPointKeys: ['10/1:10/1', '100/1:10/1', '100/1:100/1', '10/1:100/1'],
      holes: [],
      holeExactPointKeys: [],
    }

    const report = inspectReviewedPageCoverage(input)
    expect(report.status, report.refusalReason).toBe('partial')
    expect(report.wallPairs).toBe(0)
    expect(report.wallSpans.unmatched).toBe(0)
    expect(report.floorBoundary).toBe('missing')
    expect(report.openings.declaredDoors).toBe(0)
    expect(report.issues).toContain('source-areas-held')
    expect(report.issues).toContain('no-physical-room-contours')
    expect(report.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })

    room.sourceTopology.exactPointKeys.pop()
    expect(inspectReviewedPageCoverage(input).status).toBe('refused')
  })

  it('keeps decimal subroom coverage partial rather than refusing or promoting it', () => {
    const input = sample()
    const room = input.contours.rooms[0]
    const reading = input.reading.rooms[0]
    if (!room || !reading) throw new Error('Missing source coverage fixture')
    input.contours.rooms[0] = { roomSourceNumber: 3.1, polygon: room.polygon }
    reading.sourceNumber = 3.1
    const report = inspectReviewedPageCoverage(input)
    expect(report.status).toBe('partial')
    expect(report.refusalReason).toBeUndefined()
    expect(report.missingSourceNumbers).toEqual([])
    expect(report.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('keeps conditional room dividers in the review worklist, never as physical walls', () => {
    const input = sample()
    const room = input.contours.rooms[0]
    if (!room) throw new Error('Missing room')
    room.conditionalEdges = [{ wallEdgeIndex: 0 }]
    const report = inspectReviewedPageCoverage(input)
    expect(report.wallSpans.conditional).toBe(1)
    expect(report.reviewSpans.some((span) => span.status === 'conditional')).toBe(true)
    expect(report.issues).toContain('conditional-boundary-review-required')
  })
  it('bounds the review queue while retaining the total unresolved span count', () => {
    const input = sample()
    input.contours.rooms = Array.from({ length: 55 }, (_, index) => {
      const x = 10 + (index % 11) * 80
      const y = 10 + Math.floor(index / 11) * 80
      return {
        roomSourceNumber: index + 1,
        polygon: [
          { x, y },
          { x: x + 40, y },
          { x: x + 40, y: y + 40 },
          { x, y: y + 40 },
        ],
      }
    })
    input.reading.rooms = input.contours.rooms.map((room) => ({
      sourceNumber: room.roomSourceNumber,
      name: 'Тестовая комната',
      kind: 'living',
    }))
    input.linework.paths = input.contours.rooms.map((room, index) => ({
      operationIndex: index,
      subpathIndex: 0,
      closed: true,
      paint: 'stroke',
      points: room.polygon,
    }))
    const report = inspectReviewedPageCoverage(input)
    expect(report.status).toBe('partial')
    expect(report.wallSpans.unmatched).toBe(220)
    expect(report.reviewSpans).toHaveLength(200)
    expect(report.reviewSpansTruncated).toBe(true)
    expect(report.issues).toContain('review-spans-display-limited')
    expect(report.issues).toContain('wall-pairing-edge-limit')
  })
  it('keeps a valid reviewed room partial without a floor, wall bodies or opening inventory', () => {
    const input = sample(),
      before = structuredClone(input)
    const report = inspectReviewedPageCoverage(input)
    expect(report.status, report.refusalReason).toBe('partial')
    expect(report.floorBoundary).toBe('missing')
    expect(report.wallSpans.unmatched).toBe(4)
    expect(report.issues).toContain('complete-opening-inventory-unverified')
    expect(report.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(report).not.toHaveProperty('geometry')
    expect(input).toEqual(before)
  })
  it.each(['hash', 'page', 'state', 'reading-page', 'reading-state', 'vertex', 'budget'])(
    'refuses invalid %s before composing local proofs',
    (change) => {
      const input = sample()
      if (change === 'hash') input.source.sha256 = 'b'.repeat(64)
      if (change === 'page') input.source.pdfPage = 2
      if (change === 'state') input.source.state = 'proposed' as 'existing'
      if (change === 'reading-page') input.reading.sourcePage = 2
      if (change === 'reading-state') input.reading.planState = 'proposed'
      if (change === 'vertex') input.linework.paths = []
      if (change === 'budget')
        input.linework.paths = Array.from({ length: 3001 }, () => input.linework.paths[0]).filter(
          (path): path is PdfVectorPath => path !== undefined,
        )
      const report = inspectReviewedPageCoverage(input)
      expect(report.status).toBe('refused')
      expect(report.refusalReason).toBeTruthy()
      expect(report.wallPairs).toBe(0)
      expect(report.readiness.readyFor2D).toBe(false)
    },
  )
  it('reports missing source rooms instead of assuming declared contours cover the page', () => {
    const input = sample()
    input.reading.rooms.push({ sourceNumber: 2, name: 'Балкон', kind: 'living', utility: true })
    const report = inspectReviewedPageCoverage(input)
    expect(report.missingSourceNumbers).toEqual([2])
    expect(report.issues).toContain('room-inventory-partial')
  })
  it('does not promote an outer-wall envelope to a floor', () => {
    const input = sample()
    const polygon = [
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 110 },
      { x: 0, y: 110 },
    ]
    input.contours.exterior = { polygon, boundaryRole: 'outer-wall-envelope' }
    input.linework.paths.push({
      operationIndex: 2,
      subpathIndex: 0,
      paint: 'stroke',
      points: polygon,
      closed: true,
    })
    expect(inspectReviewedPageCoverage(input).floorBoundary).toBe('envelope-only')
    input.contours.floor = { polygon: structuredClone(input.contours.rooms[0]?.polygon ?? []) }
    const report = inspectReviewedPageCoverage(input)
    expect(report.floorBoundary).toBe('reviewed-floor')
    expect(report.issues).toContain('floor-area-partition-unverified')
    expect(report.status).toBe('partial')
  })
  it('keeps declared door and window spans separate from checked door pairs', () => {
    const input = sample()
    const room = input.contours.rooms[0]
    if (!room) throw new Error('Missing room')
    room.openings = [
      {
        id: 'door',
        kind: 'door',
        wallEdgeIndex: 0,
        start: room.polygon[0] ?? { x: 0, y: 0 },
        end: room.polygon[1] ?? { x: 0, y: 0 },
      },
      {
        id: 'window',
        kind: 'window',
        wallEdgeIndex: 2,
        start: room.polygon[2] ?? { x: 0, y: 0 },
        end: room.polygon[3] ?? { x: 0, y: 0 },
      },
    ]
    const report = inspectReviewedPageCoverage(input)
    expect(report.wallSpans.opening).toBe(2)
    expect(report.openings).toMatchObject({
      declaredDoors: 1,
      doorPairCandidates: 0,
      pairedDoorFaces: 0,
      nonDoorDeclarations: 1,
    })
    expect(report.issues).toContain('door-face-pairing-partial')
    expect(report.issues).toContain('non-door-declarations-unverified')
  })
  it('preserves archived real-source omissions, never using the idealized cleared layer', () => {
    const source = {
      sha256: page.source.sha256,
      pdfPage: page.source.pdfPage,
      state: 'existing' as const,
    }
    const contours: PlanPageContours = {
      source,
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: page.pageWidth,
      pageHeight: page.pageHeight,
      exterior: {
        polygon: structuredClone(page.apartmentEnvelope.polygon),
        boundaryRole: 'outer-wall-envelope',
      },
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
            ? { endpointProofs: structuredClone(opening.endpointProofs) }
            : {}),
        })) as PlanPageContours['rooms'][number]['openings'],
      })),
    }
    const reading: PlanReading = {
      readAt: '2026-10-09',
      sourcePage: source.pdfPage,
      planState: 'existing',
      rooms: Array.from({ length: 8 }, (_, index) => ({
        sourceNumber: index + 1,
        name: `Источник ${index + 1}`,
        kind: 'living',
      })),
    }
    const linework: PdfLinework = {
      coordinateSystem: 'page-0-1000',
      pageWidth: page.pageWidth,
      pageHeight: page.pageHeight,
      paths: structuredClone(page.nativePaths) as PdfVectorPath[],
      ...page.nativeLayer,
    }
    const input = { source, reading, contours, linework },
      before = structuredClone(input)
    const report = inspectReviewedPageCoverage(input)
    expect(linework.skippedCurves).toBe(45)
    expect(report.status, report.refusalReason).toBe('partial')
    expect(report.extractionComplete).toBe(false)
    expect(report.wallPairs).toBe(0)
    expect(report.floorBoundary).toBe('envelope-only')
    expect(report.wallSource).toEqual({ strictValid: false, localAuditValid: false })
    expect(report.issues).toContain('native-extraction-incomplete')
    expect(report.issues).toContain('physical-passages-unverified')
    expect(report.missingSourceNumbers).toEqual([])
    expect(input).toEqual(before)
  })
})
