import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import { nativeReviewPacket } from './plan-native-review-packet'
import { nativeReviewedFloorHeightBindings } from './plan-native-reviewed-floor-heights'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import {
  connectedNativeRoomFixture,
  numberedNativeRoomFixture,
} from './test-fixtures/native-numbered-rooms'

function fixture() {
  const input = nativeAnnotationFixture()
  return { ...input, source: input.reviewed.source, image: input.native.source }
}
describe('whole-page native inspection, separate from saved geometry', () => {
  function savedReading(): PlanReading {
    const input = fixture()
    const polygon = input.work.paths[0]?.points
    if (!polygon) throw new Error('Missing native polygon')
    return {
      readAt: '2026-10-09',
      sourcePage: input.source.pdfPage,
      planState: 'existing',
      rooms: [{ sourceNumber: 1, name: 'Гостиная', kind: 'living' }],
      pageReview: {
        version: 1,
        savedAt: '2026-10-09',
        contours: {
          source: { ...input.source },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: input.work.pageWidth,
          pageHeight: input.work.pageHeight,
          rooms: [{ roomSourceNumber: 1, polygon: structuredClone(polygon) }],
        },
      },
    }
  }
  it('checks only saved manual contours and leaves both reading and source unchanged', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: {
        status: 'partial',
        floorBoundary: 'missing',
        readiness: { readOnly: true, readyFor2D: false, readyFor3D: false },
      },
    })
    expect(input).toEqual(before)
    expect(packet.savedFrameRooms).toEqual({ status: 'checked', frames: [] })
    expect(packet.numberCircles).toEqual({ status: 'draft', refusalReason: null, cues: [] })
    expect(packet.savedReview).not.toHaveProperty('contours')
    if (packet.savedReview.status !== 'checked') throw new Error('Missing coverage')
    expect(packet.savedReview.coverage).not.toHaveProperty('reviewSpans')
    expect(nativeReviewPacket(fixture()).savedReview).toEqual({ status: 'not-saved' })
    expect(nativeReviewPacket(fixture()).savedFrameRooms).toEqual({ status: 'not-saved' })
  })
  it('shows exact one-sided wall evidence without accepting a wall', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    const polygon = input.savedReading.pageReview?.contours.rooms[0]?.polygon
    if (!polygon) throw new Error('Missing saved source contour')
    const [topLeft, topRight] = polygon
    if (!topLeft || !topRight) throw new Error('Missing source edge')
    input.work.paths.unshift({
      operationIndex: 0,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [{ x: topLeft.x, y: 80 }, { x: topRight.x, y: 80 }, { ...topRight }, { ...topLeft }],
    })
    input.work.paths.push({
      operationIndex: 101,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: topLeft.x, y: 80 },
        { x: topRight.x, y: 80 },
      ],
    })
    input.work.paths = input.work.paths.filter((path) => path.operationIndex !== 2)
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: input.work.paths.map((path) => ({
        operationIndex: path.operationIndex,
        kind: 'vector' as const,
        reason: null,
        bounds: {
          left: Math.min(...path.points.map((point) => point.x)),
          right: Math.max(...path.points.map((point) => point.x)),
          top: Math.min(...path.points.map((point) => point.y)),
          bottom: Math.max(...path.points.map((point) => point.y)),
        },
      })),
    }

    const packet = nativeReviewPacket(input)
    expect(packet.oneSidedWallSupports).toMatchObject({
      status: 'draft',
      physicalWallAccepted: false,
      candidates: [
        {
          fillEdge: { operationIndex: 0, subpathIndex: 0 },
          strokeEdge: { operationIndex: 1, subpathIndex: 0 },
          oppositeFace: {
            fillEdge: { operationIndex: 0, subpathIndex: 0 },
            strokeEdge: { operationIndex: 101, subpathIndex: 0 },
          },
        },
      ],
    })
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
  })
  it('does not report zero wall supports as a complete search with missing source ink', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      {
        operationIndex: 101,
        bounds: { left: 900, top: 900, right: 910, bottom: 910 },
        paint: 'stroke',
      },
    ]

    expect(nativeReviewPacket(input).oneSidedWallSupports).toEqual({
      status: 'unresolved',
      refusalReason: 'source-wall-evidence-incomplete',
      physicalWallAccepted: false,
      candidates: [],
    })
  })
  it('distinguishes saved review with missing native layer from no saved review', () => {
    const input = fixture()
    const packet = nativeReviewPacket({
      source: input.source,
      image: input.image,
      savedReading: savedReading(),
    })
    expect(packet.savedReview).toEqual({
      status: 'unavailable',
      reason: 'native-layer-unavailable',
    })
    expect(packet.savedFrameRooms).toEqual({
      status: 'unavailable',
      reason: 'native-layer-unavailable',
    })
    expect(packet.numberCircles).toBeUndefined()
  })
  it('shows refusal for stale saved contours instead of combining different PDFs', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    if (!input.savedReading.pageReview) throw new Error('Missing review')
    input.savedReading.pageReview.contours.source.sha256 = 'c'.repeat(64)
    const packet = nativeReviewPacket(input)
    expect(packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: { status: 'refused', refusalReason: 'different-plan-source' },
    })
    expect(packet.savedFrameRooms).toEqual({ status: 'refused', reason: 'different-plan-source' })
    expect(packet.oneSidedWallSupports).toBeUndefined()
  })
  it('aggregates only same-source candidates without creating a confirmed plan', () => {
    const input = fixture(),
      before = structuredClone(input)
    const result = nativeReviewPacket(input)
    expect(result.version).toBe(1)
    expect(result.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(result.counts.printedDimensions).toBe(1)
    expect(result.issues.map((issue) => issue.code)).toContain('floor-boundaries-unreviewed')
    expect(result).not.toHaveProperty('footprint')
    expect(result).not.toHaveProperty('pageReview')
    expect(JSON.stringify(result)).not.toContain('manual-native-annotation-review')
    expect(input).toEqual(before)
  })
  it('exposes filled source profiles independently of physical frames and glazing', () => {
    const input = fixture()
    const rectangle = (operationIndex: number, left: number, right: number) => ({
      operationIndex,
      subpathIndex: 0,
      paint: 'fill' as const,
      closed: true,
      points: [
        { x: left, y: 40 },
        { x: right, y: 40 },
        { x: right, y: 50 },
        { x: left, y: 50 },
      ],
    })
    input.work.paths.push(rectangle(100, 30, 100), rectangle(101, 25, 32), rectangle(102, 98, 105))
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.filledPanelSymbols).toMatchObject({
      status: 'draft',
      basis: 'native-filled-quad-and-opposed-cap-overlap',
      completeOpeningInventory: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      finalPaintVisibilityProved: false,
      candidates: [
        {
          id: 'native-filled-panel-100:0',
          sourceRefs: [100, 102, 101].map((operationIndex) => ({
            operationIndex,
            subpathIndex: 0,
          })),
        },
      ],
    })
    expect(packet.openingFrames?.candidates).toEqual([])
    expect(packet.glazingSymbols?.candidates).toEqual([])
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)
  })
  it('rechecks saved source-floor geometry including decimal ownership, and holds a stale selection', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 100,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 600, y: 600 },
        { x: 800, y: 600 },
        { x: 800, y: 800 },
        { x: 600, y: 800 },
      ],
    })
    input.native.labels.push(
      {
        id: 'native-text-400',
        nativeIndex: 400,
        name: 'Гардероб',
        point: { x: 650, y: 650 },
        pagePoint: { x: 650, y: 650 },
        rotation: 0,
      },
      {
        id: 'native-text-401',
        nativeIndex: 401,
        name: '3.1',
        point: { x: 650, y: 670 },
        pagePoint: { x: 650, y: 670 },
        rotation: 0,
      },
    )
    const region = nativeVisiblePaintRegions(input).regions.find(
      (region) => region.candidateId === 'native-fill-100:0',
    )
    const piece = region?.pieces[0]
    if (!piece) throw new Error('Missing source-floor piece')
    const reviewed = {
      review: 'manual-native-painted-floor-review',
      source: input.source,
      rasterSource: input.image,
      floors: [
        {
          candidateId: 'native-fill-100:0',
          pieceIndex: 0,
          polygon: piece.polygon,
          holes: piece.holes,
          owner: {
            sourceRoomKey: '3.1',
            nameLabelId: 'native-text-400',
            numberLabelId: 'native-text-401',
          },
          boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
        },
      ],
    }
    const reading: PlanReading = {
      readAt: '2026-10-12',
      rooms: [],
      sourcePage: 1,
      planState: 'existing',
      paintedFloorReview: {
        version: 1,
        savedAt: '2026-10-12',
        draftJson: JSON.stringify(reviewed),
      },
    }
    const packet = nativeReviewPacket({ ...input, savedReading: reading })
    expect(packet.savedPaintedFloors).toMatchObject({
      status: 'checked',
      physicalBoundariesAccepted: false,
      measurementsConfirmed: false,
      commonZeroConfirmed: false,
      floors: [{ sourceRoomKey: '3.1', name: 'Гардероб', unresolvedEdges: 4 }],
    })
    expect(packet.readiness.readyFor3D).toBe(false)
    const firstPoint = reviewed.floors[0]?.polygon[0]
    if (!firstPoint) throw new Error('Missing reviewed point')
    firstPoint.x += 1
    reading.paintedFloorReview = {
      version: 1,
      savedAt: '2026-10-12',
      draftJson: JSON.stringify(reviewed),
    }
    expect(
      nativeReviewPacket({ ...input, savedReading: reading }).savedPaintedFloors,
    ).toMatchObject({ status: 'refused', floors: [] })
  })
  it('keeps scale and jamb diagnostics separate from accepted calibration and geometry', () => {
    const input = fixture()
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.scaleEvidence).toMatchObject({
      status: 'unresolved',
      dimensionToleranceMm: 2,
      axes: [],
      commonScale: { status: 'insufficient', referenceLabelId: null, mmPerPoint: null },
      unresolved: [],
    })
    expect(packet.dimensionTargets?.jambSpans).toEqual([])
    expect(packet.scaleEvidence).not.toHaveProperty('source')
    expect(packet.scaleEvidence).not.toHaveProperty('mayTransfer2D')
    expect(packet).not.toHaveProperty('pdfCalibration')
    expect(packet).not.toHaveProperty('geometry')
    expect(packet).not.toHaveProperty('pageSizeCm')
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet.heightObservations?.locations).toMatchObject({
      status: 'unresolved',
      observations: [],
    })
    expect(packet.heightObservations?.locations).not.toHaveProperty('source')
    expect(packet.heightObservations?.locations).not.toHaveProperty('roomOwnershipConfirmed')
    expect(packet.heightObservations?.locations).not.toHaveProperty('mayTransfer3D')
    expect(packet.heightObjects).toBeDefined()
    expect(packet.heightObjects).not.toHaveProperty('commonZeroConfirmed')
    expect(packet.heightObjects).not.toHaveProperty('geometryOwnersConfirmed')
    expect(packet.heightObjects).not.toHaveProperty('mayTransfer2D3D')
    expect(packet.heightObjects).not.toHaveProperty('source')
    expect(input).toEqual(before)
  })
  it('maps source swings and painted jamb frames to pixels without authorizing floor closure', () => {
    const input = fixture()
    input.work.paths.push(
      {
        operationIndex: 40,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
      },
      {
        operationIndex: 41,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: [
          { x: 100, y: 100 },
          { x: 120, y: 100 },
          { x: 120, y: 200 },
          { x: 100, y: 200 },
        ],
      },
    )
    for (const [operationIndex, y] of [
      [42, 100],
      [43, 200],
    ] as const)
      input.work.paths.push({
        operationIndex,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: [
          { x: 80, y },
          { x: 140, y },
          { x: 140, y: y - 10 },
          { x: 130, y: y - 10 },
          { x: 130, y: y - 20 },
          { x: 80, y: y - 20 },
        ],
      })
    const k = (4 / 3) * Math.tan(Math.PI / 8) * 100
    input.work.curvePaths = [
      {
        operationIndex: 44,
        subpathIndex: 0,
        operationSubpathCount: 1,
        paint: 'stroke',
        closed: false,
        start: { x: 200, y: 100 },
        segments: [
          {
            kind: 'cubic',
            control1: { x: 200, y: 100 + k },
            control2: { x: 100 + k, y: 200 },
            end: { x: 100, y: 200 },
          },
        ],
      },
    ]
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 44, bounds: { left: 100, top: 100, right: 200, bottom: 200 } },
    ]
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.doorSymbols).toMatchObject({
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-door-symbol-44:0',
          arc: { start: { x: 200, y: 100 } },
          leaf: { start: { x: 100, y: 100 }, end: { x: 200, y: 100 } },
          endpointResidualPixels: 0,
        },
      ],
    })
    expect(packet.openingFrames).toMatchObject({
      status: 'draft',
      refusalReason: null,
      candidates: [{ id: 'native-opening-frame-41:0' }],
    })
    expect(packet.extraction.skippedCurves).toBe(1)
    expect(packet.extraction.geometryComplete).toBe(false)
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet.doorSymbols?.candidates[0]).not.toHaveProperty('closedTip')
    expect(packet.openingFrames?.candidates[0]).not.toHaveProperty('jambs')
    expect(packet).not.toHaveProperty('floor')
    expect(input).toEqual(before)
  })
  it('shows exact numbered unfilled outlines in the read-only source overlay', () => {
    const input = numberedNativeRoomFixture()
    input.work.paths = input.work.paths.map((path) => ({ ...path, paint: 'stroke' }))
    const before = structuredClone(input)
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.counts.numberedAssociations).toBe(3)
    expect(packet.roomSchedule).toMatchObject({
      status: 'draft',
      refusalReason: null,
      rows: [
        { sourceNumber: 1, name: 'Спальня', documentaryAreaM2: 12.5, markerStatus: 'unobserved' },
        { sourceNumber: 2, name: 'Спальня', documentaryAreaM2: 12.5, markerStatus: 'unobserved' },
        { sourceNumber: 3, name: 'Балкон', documentaryAreaM2: 5.5, markerStatus: 'unobserved' },
      ],
      unlistedMarkerLabelIds: [],
    })
    expect(packet.roomSchedule?.rows[0]).not.toHaveProperty('polygon')
    expect(packet.roomSchedule?.rows[0]).not.toHaveProperty('tableEdges')
    expect(packet.roomSchedule).not.toHaveProperty('roomOwnershipConfirmed')
    expect(packet.counts.fillCandidates).toBe(0)
    expect(packet.faces.filter((face) => face.roomName).map((face) => face.roomName)).toEqual([
      'Спальня',
      'Спальня',
      'Балкон',
    ])
    expect(packet.faces.every((face) => face.layer === 'stroke')).toBe(true)
    expect(packet.faces[2]?.polygon).toEqual(
      input.work.paths.find((path) => path.operationIndex === 3)?.points,
    )
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet).not.toHaveProperty('pageReview')
    expect(input).toEqual(before)
  })
  it('shows actual glazing bodies, endcaps and centerline without creating a window or floor', () => {
    const input = fixture()
    const polygons = [
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 105 },
        { x: 100, y: 105 },
      ],
      [
        { x: 95, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 105 },
        { x: 95, y: 105 },
      ],
      [
        { x: 200, y: 100 },
        { x: 205, y: 100 },
        { x: 205, y: 105 },
        { x: 200, y: 105 },
      ],
    ]
    for (const [index, points] of polygons.entries())
      input.work.paths.push({
        operationIndex: 80 + index,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points,
      })
    input.work.paths.push({
      operationIndex: 83,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 100, y: 102.5 },
        { x: 200, y: 102.5 },
      ],
    })
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.glazingSymbols).toEqual({
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-glazing-symbol-80:0',
          polygons,
          centerline: { start: { x: 100, y: 102.5 }, end: { x: 200, y: 102.5 } },
        },
      ],
    })
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet).not.toHaveProperty('floor')
    expect(packet.glazingSymbols?.candidates[0]).not.toHaveProperty('openingKind')
    expect(input).toEqual(before)
    // Competing source centerlines cannot silently become a guessed glazing candidate.
    const centerline = input.work.paths.at(-1)
    if (!centerline) throw new Error('Missing source centerline fixture')
    input.work.paths.push({ ...structuredClone(centerline), operationIndex: 84 })
    expect(nativeReviewPacket(input).glazingSymbols?.candidates).toEqual([])
  })
  it('reports unavailable panel search explicitly without inventing fallback geometry', () => {
    const input = fixture()
    // No curve-command layer is needed for glazing, but incomplete source geometry
    // still holds both new profiles and the old openings; no fallback invents a panel.
    input.work.unsupportedContexts = 1
    const packet = nativeReviewPacket(input)
    expect(packet.glazingSymbols).toEqual({
      status: 'unresolved',
      refusalReason: 'incomplete-native-layer',
      candidates: [],
    })
    expect(packet.issues.some((issue) => issue.code.startsWith('panel-profile-search:'))).toBe(true)
    expect(packet.readiness.readOnly).toBe(true)
  })
  it('serializes source symbol groups without transferring contact proof to a floor', () => {
    const input = fixture()
    const addPath = (operationIndex: number, points: number[][], closed = true) => {
      input.work.paths.push({
        operationIndex,
        subpathIndex: 0,
        paint: 'stroke',
        closed,
        points: points.map(([x, y]) => ({ x: x as number, y: y as number })),
      })
    }
    for (const [base, left] of [
      [80, 100],
      [84, 215],
    ] as const) {
      addPath(base, [
        [left, 100],
        [left + 100, 100],
        [left + 100, 105],
        [left, 105],
      ])
      addPath(base + 1, [
        [left - 5, 100],
        [left, 100],
        [left, 105],
        [left - 5, 105],
      ])
      addPath(base + 2, [
        [left + 100, 100],
        [left + 105, 100],
        [left + 105, 105],
        [left + 100, 105],
      ])
      addPath(
        base + 3,
        [
          [left, 102.5],
          [left + 100, 102.5],
        ],
        false,
      )
    }
    addPath(90, [
      [80, 95],
      [95, 95],
      [95, 102.5],
      [90, 102.5],
      [90, 110],
      [80, 110],
    ])
    addPath(91, [
      [320, 95],
      [335, 95],
      [335, 110],
      [325, 110],
      [325, 102.5],
      [320, 102.5],
    ])
    addPath(92, [
      [203, 98],
      [212, 98],
      [212, 100],
      [210, 100],
      [210, 102.5],
      [205, 102.5],
      [205, 100],
      [203, 100],
    ])
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.sourceLinks).toEqual({
      status: 'draft',
      refusalReason: null,
      doors: [],
      glazing: [
        { symbolId: 'native-glazing-symbol-80:0', status: 'two-sided' },
        { symbolId: 'native-glazing-symbol-84:0', status: 'two-sided' },
      ],
      groups: [
        {
          id: 'native-source-symbol-group-1',
          glazingIds: ['native-glazing-symbol-80:0', 'native-glazing-symbol-84:0'],
          doorIds: [],
        },
      ],
    })
    expect(packet.sourceLinks).not.toHaveProperty('profiles')
    expect(packet.sourceLinks?.groups[0]).not.toHaveProperty('bridges')
    expect(packet).not.toHaveProperty('footprint')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)
  })
  it('shows shared-wall source candidates without erasing frames or approving a floor', () => {
    const input = connectedNativeRoomFixture()
    const before = structuredClone(input)
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.counts.numberedAssociations).toBe(3)
    expect(packet.faces.filter((face) => face.roomName)).toHaveLength(3)
    expect(packet.faces.find((face) => face.roomName === 'Спальня')?.polygon).toEqual([
      { x: 50, y: 50 },
      { x: 275, y: 50 },
      { x: 275, y: 300 },
      { x: 50, y: 300 },
    ])
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)
  })
  it('withholds an oversized overlay instead of serializing or silently truncating 103 shapes', () => {
    const input = numberedNativeRoomFixture()
    input.work.paths = input.work.paths.map((path) => ({
      ...path,
      paint: path.paint === 'fill' ? 'fill-stroke' : path.paint,
    }))
    for (let index = 0; index < 47; index++)
      input.work.paths.push({
        operationIndex: 500 + index,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 500 + index / 100, y: 600 },
          { x: 600, y: 600 },
          { x: 600, y: 700 },
          { x: 500 + index / 100, y: 700 },
        ],
      })
    // Keep this unrelated overlay grid away from the documentary table. A grid
    // cutting through its captions now correctly holds the table, tested separately.
    for (let column = 0; column <= 5; column++)
      input.work.paths.push({
        operationIndex: 600 + column,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 650 + column * 60, y: 450 },
          { x: 650 + column * 60, y: 850 },
        ],
      })
    for (let row = 0; row <= 10; row++)
      input.work.paths.push({
        operationIndex: 700 + row,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 650, y: 450 + row * 40 },
          { x: 950, y: 450 + row * 40 },
        ],
      })
    // This legacy localized-omission path does not run the complete-layer face expansion.
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      {
        operationIndex: 900,
        bounds: { left: 900, top: 900, right: 910, bottom: 910 },
      },
    ]
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.counts.fillCandidates).toBe(50)
    expect(packet.counts.strokeFaces).toBe(53)
    expect(packet.counts.numberedAssociations).toBe(3)
    expect(packet.status).toBe('unresolved')
    expect(packet.faces).toEqual([])
    expect(packet.issues.map((issue) => issue.code)).toContain('native-overlay-limit')
    expect(packet.readiness.readyFor2D).toBe(false)
  }, 20_000)
  it('explains unavailable native layers rather than treating zero candidates as complete', () => {
    const input = fixture()
    const result = nativeReviewPacket({ source: input.source, image: input.image })
    expect(result.status).toBe('unresolved')
    expect(result.faces).toEqual([])
    expect(result.issues[0]?.code).toBe('native-layers-unavailable')
  })
  it('preserves localized omitted curves as an incompleteness blocker', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 1000, bounds: { left: 900, right: 950, top: 900, bottom: 950 } },
    ]
    const result = nativeReviewPacket(input)
    expect(result.status).toBe('unresolved')
    expect(result.extraction.geometryComplete).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('native-geometry-incomplete')
  })
  it.each(['pdf', 'raster', 'page', 'state'])(
    'rejects mismatched %s evidence instead of composing different sources',
    (kind) => {
      const input = fixture()
      if (kind === 'pdf') input.source = { ...input.source, sha256: 'c'.repeat(64) }
      if (kind === 'raster') input.image = { ...input.image, sha256: 'c'.repeat(64) }
      if (kind === 'page') input.source = { ...input.source, pdfPage: 2 }
      if (kind === 'state') input.source = { ...input.source, state: 'proposed' as 'existing' }
      expect(() => nativeReviewPacket(input)).toThrow()
    },
  )
})

import type { PlanReading } from '@uyut/db'

it('freshly checks saved source height-to-floor IDs without accepting a ceiling or geometry', () => {
  const input = floorHeightFixture()
  const options = nativeReviewedFloorHeightBindings(input)
  const option = options.options[0]
  if (!option) throw new Error('Missing synthetic source height')
  const reviewed = {
    ...options.review,
    bindings: [{ floorId: option.floorId, labelId: option.labelId }],
  }
  const reading: PlanReading = {
    rooms: [],
    readAt: input.floorReviewSavedAt,
    sourcePage: input.reviewedFloors.source.pdfPage,
    planState: 'existing',
    paintedFloorReview: {
      version: 1,
      savedAt: input.floorReviewSavedAt,
      draftJson: JSON.stringify(input.reviewedFloors),
    },
    heightBindingReview: {
      version: 1,
      savedAt: input.floorReviewSavedAt,
      draftJson: JSON.stringify(reviewed),
    },
  }
  const packetInput = {
    ...input,
    source: input.reviewedFloors.source,
    image: input.native.source,
    savedReading: reading,
  }
  const packet = nativeReviewPacket(packetInput)
  expect(packet.savedFloorHeights).toMatchObject({
    status: 'checked',
    reason: null,
    ceilingHeightsConfirmed: false,
    commonZeroConfirmed: false,
    readyFor2D: false,
    readyFor3D: false,
    bindings: [{ sourceRoomKey: '3.1', valueMm: 2700, quantityKind: 'unclassified-height' }],
  })
  expect(packet.readiness.readyFor3D).toBe(false)
  reading.heightBindingReview = {
    version: 1,
    savedAt: input.floorReviewSavedAt,
    draftJson: JSON.stringify({
      ...reviewed,
      bindings: [{ ...reviewed.bindings[0], valueMm: 3500 }],
    }),
  }
  expect(nativeReviewPacket(packetInput).savedFloorHeights).toMatchObject({
    status: 'refused',
    bindings: [],
  })
  delete reading.paintedFloorReview
  expect(nativeReviewPacket(packetInput).savedFloorHeights).toMatchObject({
    status: 'refused',
    bindings: [],
  })
})
