import { describe, expect, it } from 'vitest'
import { nativeReviewPacket } from './plan-native-review-packet'
import { nativeSourceObjectReportsValid } from './plan-native-source-object-contract'

function fixture() {
  const packet = nativeReviewPacket({
    source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
    image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
  })
  const rectangle = (left: number, right: number) => [
    { x: left, y: 100 },
    { x: right, y: 100 },
    { x: right, y: 110 },
    { x: left, y: 110 },
  ]
  packet.filledPanelSymbols = {
    status: 'draft',
    basis: 'native-filled-quad-and-opposed-cap-overlap',
    refusalReason: null,
    completeOpeningInventory: false,
    physicalJambAccepted: false,
    physicalPassageAccepted: false,
    closesFloorBoundary: false,
    finalPaintVisibilityProved: false,
    candidates: [
      {
        id: 'native-filled-panel-10:0',
        sourceRefs: [10, 11, 12].map((operationIndex) => ({ operationIndex, subpathIndex: 0 })),
        polygons: [rectangle(100, 200), rectangle(90, 101), rectangle(199, 210)],
        laterPaintCount: 0,
        omittedInkCount: 0,
      },
    ],
  }
  packet.filledPanelEnds = {
    status: 'draft',
    refusalReason: null,
    physicalJambAccepted: false,
    wallOwnershipConfirmed: false,
    panels: [
      {
        panelId: 'native-filled-panel-10:0',
        status: 'paired',
        ends: [1, 3].map((edgeIndex) => ({
          edgeIndex,
          status: 'matched' as const,
          coverage: 'complete' as const,
          reason: null,
          sourceEdges: [{ operationIndex: 20 + edgeIndex, subpathIndex: 0, segmentIndex: 0 }],
        })),
      },
    ],
  }
  packet.heightFloorReferences = {
    status: 'draft',
    refusalReason: null,
    commonWorldZeroConfirmed: false,
    coplanarFloorsConfirmed: false,
    geometryOwnersConfirmed: false,
    mayTransfer2D3D: false,
    references: [
      {
        labelId: 'native-text-230',
        originalText: '1. Все отметки высот на замере даны от чистового пола',
        status: 'verified',
        datum: 'local-finished-floor',
        inkSourceOperations: [100, 103, 106],
        reason: null,
      },
    ],
  }
  const polygon = [
    { x: 300, y: 300 },
    { x: 500, y: 300 },
    { x: 500, y: 500 },
    { x: 300, y: 500 },
  ]
  packet.orderedPaint = {
    status: 'diagnostic',
    refusalReason: null,
    regions: [
      {
        candidateId: 'native-fill-40:0',
        status: 'diagnostic',
        refusalReason: null,
        maskCount: 0,
        omittedStrokeCount: 0,
        boundaryInkComplete: true,
        pieces: [{ polygon, holes: [] }],
      },
    ],
  }
  packet.savedPaintedFloors = {
    status: 'checked',
    reason: null,
    physicalBoundariesAccepted: false,
    measurementsConfirmed: false,
    commonZeroConfirmed: false,
    floors: [
      {
        id: 'native-fill-40:0:piece-0',
        candidateId: 'native-fill-40:0',
        sourceRoomKey: '3.1',
        name: 'Гардероб',
        nameLabelId: 'native-text-217',
        numberLabelId: 'native-text-219',
        polygon,
        holes: [],
        unresolvedEdges: 4,
        omittedStrokeCount: 0,
        boundaryInkComplete: true,
      },
    ],
  }
  return packet
}
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing contract fixture')
  return value
}
function heightBindingPacket() {
  const packet = fixture()
  packet.heightObservations = {
    status: 'draft',
    refusalReason: null,
    issues: [],
    omissionCounts: { skippedCurves: 0, clippedPaths: 0 },
    observations: [
      {
        labelId: 'native-text-152',
        originalText: 'Н=2700',
        valueMm: 2700,
        quantityKind: 'unclassified-height',
        datum: 'unspecified',
        issueCodes: ['height-role-unclassified', 'height-datum-unverified'],
        mayAcceptFor3D: false,
        unitEvidence: {
          kind: 'same-page-millimetre-declaration',
          labelId: 'native-text-237',
          originalText: 'Размеры указаны в миллиметрах',
          nativeIndex: 237,
          inkSourceOperation: 14076,
          source: packet.source,
        },
      },
    ],
  }
  packet.savedFloorHeights = {
    status: 'checked',
    reason: null,
    associationBasis: 'manual-whole-source-caption-in-selected-floor',
    physicalBoundariesAccepted: false,
    ceilingHeightsConfirmed: false,
    commonZeroConfirmed: false,
    readyFor2D: false,
    readyFor3D: false,
    bindings: [
      {
        floorId: 'native-fill-40:0:piece-0',
        sourceRoomKey: '3.1',
        name: 'Гардероб',
        labelId: 'native-text-152',
        originalText: 'Н=2700',
        valueMm: 2700,
        quantityKind: 'unclassified-height',
        localReferenceLabelId: 'native-text-230',
      },
    ],
  }
  return packet
}

describe('saved source-height wire associations', () => {
  it('requires a current floor, literal height and verified local reference without 3D acceptance', () => {
    expect(nativeSourceObjectReportsValid(heightBindingPacket())).toBe(true)
  })
  it.each([
    'floor',
    'owner',
    'value',
    'label',
    'reference',
    'units',
    'duplicate',
    'claimed-ceiling',
    'claimed-zero',
    'claimed-3d',
  ])('rejects stale or promoted %s associations', (change) => {
    const packet = heightBindingPacket(),
      report = present(packet.savedFloorHeights)
    const row = present(report.bindings[0])
    if (change === 'floor') row.floorId = 'native-fill-unknown:piece-0'
    if (change === 'owner') row.sourceRoomKey = '3'
    if (change === 'value') row.valueMm = 3800
    if (change === 'label') row.labelId = 'native-text-165'
    if (change === 'reference') row.localReferenceLabelId = 'native-text-999'
    if (change === 'units')
      present(present(packet.heightObservations).observations[0]).unitEvidence = undefined
    if (change === 'duplicate') report.bindings.push({ ...row })
    if (change === 'claimed-ceiling') Object.assign(report, { ceilingHeightsConfirmed: true })
    if (change === 'claimed-zero') Object.assign(report, { commonZeroConfirmed: true })
    if (change === 'claimed-3d') Object.assign(row, { heightCm: 270 })
    expect(nativeSourceObjectReportsValid(packet)).toBe(false)
  })
  it('requires empty refused inventories and does not infer local reference from common zero', () => {
    const packet = heightBindingPacket(),
      report = present(packet.savedFloorHeights)
    report.status = 'refused'
    report.reason = 'stale-room-height-review'
    expect(nativeSourceObjectReportsValid(packet)).toBe(false)
    report.bindings = []
    expect(nativeSourceObjectReportsValid(packet)).toBe(true)
  })
})
describe('source-object wire contract without physical promotion', () => {
  it('accepts literal decimal owner, exact source snapshot and local datum but no transfer', () => {
    const packet = fixture()
    expect(nativeSourceObjectReportsValid(packet)).toBe(true)
    expect(packet.readiness.readyFor3D).toBe(false)
  })
  it.each([
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.heightFloorReferences as object, { commonWorldZeroConfirmed: true }),
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.heightFloorReferences as object, { coplanarFloorsConfirmed: true }),
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.heightFloorReferences as object, { mayTransfer2D3D: true }),
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.savedPaintedFloors as object, { physicalBoundariesAccepted: true }),
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.savedPaintedFloors as object, { measurementsConfirmed: true }),
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.filledPanelEnds as object, { physicalJambAccepted: true }),
    (packet: ReturnType<typeof fixture>) =>
      Object.assign(packet.filledPanelEnds as object, { wallOwnershipConfirmed: true }),
  ])('rejects physical/global promotion %s', (mutate) => {
    const packet = fixture()
    mutate(packet)
    expect(nativeSourceObjectReportsValid(packet)).toBe(false)
  })
  it('rejects long-edge parity and a component claiming its own body or cap as independent support', () => {
    for (const operation of [10, 11, 12]) {
      const packet = fixture()
      const end = present(present(packet.filledPanelEnds).panels[0]?.ends[0])
      present(end.sourceEdges[0]).operationIndex = operation
      expect(nativeSourceObjectReportsValid(packet)).toBe(false)
    }
    const packet = fixture()
    const ends = present(present(packet.filledPanelEnds).panels[0]).ends
    present(ends[0]).edgeIndex = 0
    present(ends[1]).edgeIndex = 2
    expect(nativeSourceObjectReportsValid(packet)).toBe(false)
  })
  it('rejects stale floor geometry, a coerced decimal room key and claimed full boundary with omissions', () => {
    for (const mutate of [
      (floor: NonNullable<ReturnType<typeof fixture>['savedPaintedFloors']>['floors'][number]) => {
        floor.polygon = floor.polygon.map((point) => ({ x: point.x + 1, y: point.y }))
      },
      (floor: NonNullable<ReturnType<typeof fixture>['savedPaintedFloors']>['floors'][number]) => {
        floor.sourceRoomKey = '3.10'
      },
      (floor: NonNullable<ReturnType<typeof fixture>['savedPaintedFloors']>['floors'][number]) => {
        floor.omittedStrokeCount = 1
      },
    ]) {
      const packet = fixture()
      mutate(present(present(packet.savedPaintedFloors).floors[0]))
      expect(nativeSourceObjectReportsValid(packet)).toBe(false)
    }
  })
  it('does not accept a common-zero sentence as the local reference grammar', () => {
    const packet = fixture()
    present(present(packet.heightFloorReferences).references[0]).originalText +=
      '. Все полы на одном уровне'
    expect(nativeSourceObjectReportsValid(packet)).toBe(false)
  })
  it('accepts held reports only with empty result inventories', () => {
    const packet = fixture()
    const saved = present(packet.savedPaintedFloors)
    saved.status = 'refused'
    saved.reason = 'stale-painted-floor-selection'
    expect(nativeSourceObjectReportsValid(packet)).toBe(false)
    saved.floors = []
    expect(nativeSourceObjectReportsValid(packet)).toBe(true)
  })
})
