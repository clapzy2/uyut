import { afterEach, describe, expect, it, vi } from 'vitest'
import * as floors from './plan-native-floor-cavities'
import * as leaders from './plan-native-height-leaders'
import { nativeHeightSourceLocations } from './plan-native-height-locations'

type Input = Parameters<typeof nativeHeightSourceLocations>[0]
function fixture(): Input {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const image = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const text = 'Натяжной потолок = 2700 мм от существующего пола'
  const quad: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ] = [
    { x: 120, y: 120 },
    { x: 180, y: 120 },
    { x: 180, y: 130 },
    { x: 120, y: 130 },
  ]
  const rectangle = (
    operationIndex: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => ({
    operationIndex,
    subpathIndex: 0,
    closed: true,
    paint: 'fill-stroke' as const,
    fillColor: '#736a5d',
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  })
  return {
    source,
    lineworkSource: { ...image },
    native: {
      source: image,
      originalPdfSha256: source.sha256,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-0',
          nativeIndex: 0,
          name: text,
          rotation: 0,
          point: { x: 120, y: 130 },
          pagePoint: { x: 120, y: 130 },
        },
      ],
      heightCaptionInk: {
        source: { sha256: source.sha256, pdfPage: 1, pageWidth: 1000, pageHeight: 1000 },
        complete: true,
        refusalReason: null,
        unresolved: [],
        items: [
          {
            index: 0,
            text,
            fontName: 'F1',
            operationIndex: 100,
            quad,
            baselineStart: { x: 120, y: 130 },
            baselineEnd: { x: 180, y: 130 },
          },
        ],
      },
    },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
      paths: [
        rectangle(1, 90, 90, 100, 310),
        rectangle(2, 300, 90, 310, 310),
        rectangle(3, 100, 90, 300, 100),
        rectangle(4, 100, 300, 300, 310),
      ],
    },
  }
}
function itemOf(input: Input) {
  const ink = input.native.heightCaptionInk
  const item = ink?.items[0]
  if (!ink || !item) throw new Error('Missing synthetic height ink')
  return { ink, item }
}

function addLeader(input: Input) {
  input.work.paths.push(
    {
      operationIndex: 20,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: [
        { x: 110, y: 110 },
        { x: 190, y: 110 },
        { x: 190, y: 140 },
        { x: 110, y: 140 },
      ],
    },
    {
      operationIndex: 21,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 190, y: 125 },
        { x: 240, y: 125 },
      ],
    },
    {
      operationIndex: 22,
      subpathIndex: 0,
      paint: 'fill-stroke',
      fillColor: '#545454',
      closed: true,
      points: [
        { x: 240, y: 124.5 },
        { x: 245, y: 125 },
        { x: 240, y: 125.5 },
      ],
    },
  )
}
afterEach(() => vi.restoreAllMocks())

describe('whole source height caption locations, not semantic owners', () => {
  it('keeps source leader targets separate from the position and unaccepted height owner', () => {
    const input = fixture()
    addLeader(input)
    const before = structuredClone(input)
    const result = nativeHeightSourceLocations(input)
    expect(result.observations[0]).toMatchObject({
      status: 'inside-single-cavity',
      cavityIds: ['native-floor-cavity-1'],
      leader: {
        status: 'linked',
        reason: null,
        cavityIds: ['native-floor-cavity-1'],
        source: {
          boxRefs: [{ operationIndex: 20, subpathIndex: 0 }],
          stemRefs: [{ operationIndex: 21, subpathIndex: 0, segmentIndex: 0 }],
          arrowRef: { operationIndex: 22, subpathIndex: 0 },
        },
      },
    })
    expect(result).toMatchObject({
      roomOwnershipConfirmed: false,
      assignsGeometryHeights: false,
      mayTransfer3D: false,
    })
    expect(result.observations[0]?.leader?.source).not.toHaveProperty('tip')
    expect(result.observations[0]?.leader?.source).not.toHaveProperty('arrowPolygon')
    expect(input).toEqual(before)
  })

  it('retains an exact leader source proof while holding the omitted target cavity', () => {
    const input = fixture()
    addLeader(input)
    const floor = floors.nativeFloorCavityCandidates(input)
    const cell = floor.cavities[0]
    if (!cell) throw new Error('Missing floor')
    cell.omittedBoundaryInkCount = 1
    vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(floor)
    expect(nativeHeightSourceLocations(input).observations[0]).toMatchObject({
      status: 'unresolved',
      leader: {
        status: 'unresolved',
        cavityIds: ['native-floor-cavity-1'],
        reason: 'height-leader-target-unverified',
        source: { arrowRef: { operationIndex: 22, subpathIndex: 0 } },
      },
    })
  })

  it('does not choose one of the competing source leader target cavities', () => {
    const input = fixture()
    addLeader(input)
    const floor = floors.nativeFloorCavityCandidates(input)
    const cell = floor.cavities[0]
    if (!cell) throw new Error('Missing floor')
    floor.cavities.push({ ...structuredClone(cell), id: 'other-cavity' })
    vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(floor)
    expect(nativeHeightSourceLocations(input).observations[0]?.leader).toMatchObject({
      status: 'ambiguous',
      cavityIds: ['native-floor-cavity-1', 'other-cavity'],
      reason: 'competing-height-leader-targets',
    })
  })

  it('requires the whole arrow inside a cavity, not just its tip', () => {
    const input = fixture()
    addLeader(input)
    const floor = floors.nativeFloorCavityCandidates(input)
    // Isolate target containment from the independent source-junction guard:
    // a real wall at the base would correctly block the source chain first.
    for (const path of input.work.paths) {
      if (path.operationIndex >= 20) continue
      for (const point of path.points) {
        if (point.x === 300) point.x = 320
        else if (point.x === 310) point.x = 330
      }
    }
    vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(floor)
    const arrow = input.work.paths.find((path) => path.operationIndex === 22)
    if (!arrow) throw new Error('Missing source arrow')
    // Replay the arrow backwards: its tip is inside but its base touches the
    // floor. The source chain remains exact; target containment must stay held.
    arrow.points = [
      { x: 300, y: 124.5 },
      { x: 295, y: 125 },
      { x: 300, y: 125.5 },
    ]
    const stem = input.work.paths.find((path) => path.operationIndex === 21)
    const box = input.work.paths.find((path) => path.operationIndex === 20)
    const { item } = itemOf(input)
    const label = input.native.labels[0]
    if (!stem || !box || !label?.pagePoint) throw new Error('Missing source caption')
    box.points = box.points.map(({ x, y }) => ({ x: x + 300, y }))
    stem.points = [
      { x: 410, y: 125 },
      { x: 300, y: 125 },
    ]
    item.quad = item.quad.map(({ x, y }) => ({ x: x + 300, y })) as typeof item.quad
    item.baselineStart.x += 300
    item.baselineEnd.x += 300
    label.point.x += 300
    label.pagePoint.x += 300
    expect(nativeHeightSourceLocations(input).observations[0]?.leader).toMatchObject({
      status: 'unresolved',
      reason: 'height-leader-target-unverified',
    })
  })

  it('clears all locations when the shared source leader budget is exhausted', () => {
    const input = fixture()
    vi.spyOn(leaders, 'createNativeHeightLeaderVerifier').mockReturnValue(() => ({
      status: 'unresolved',
      reason: 'height-leader-work-limit',
    }))
    expect(nativeHeightSourceLocations(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'height-leader-work-limit',
      observations: [],
    })
  })

  it('locates the entire verified caption in one fresh cavity without accepting a height', () => {
    const input = fixture()
    const before = structuredClone(input)
    const report = nativeHeightSourceLocations(input)
    expect(report.observations).toMatchObject([
      {
        labelId: 'native-text-0',
        status: 'inside-single-cavity',
        cavityIds: ['native-floor-cavity-1'],
        inkSourceOperation: 100,
        reason: null,
      },
    ])
    expect(report).toMatchObject({
      roomOwnershipConfirmed: false,
      assignsGeometryHeights: false,
      mayTransfer2D: false,
      mayTransfer3D: false,
      readOnly: true,
    })
    expect(report).not.toHaveProperty('heightCm')
    expect(report).not.toHaveProperty('roomId')
    expect(input).toEqual(before)
    report.observations[0]?.cavityIds.push('changed')
    expect(input).toEqual(before)
  })

  it.each([300, 301, 300.000000001])(
    'does not use an inside baseline when whole ink reaches %s',
    (right) => {
      const input = fixture()
      const { item } = itemOf(input)
      item.quad[1].x = right
      item.quad[2].x = right
      expect(nativeHeightSourceLocations(input).observations[0]?.status).toBe('unresolved')
    },
  )

  it('does not snap a 1e-9 separation onto a boundary', () => {
    const input = fixture()
    const { item } = itemOf(input)
    item.quad[1].x = 300 - 1e-9
    item.quad[2].x = 300 - 1e-9
    expect(nativeHeightSourceLocations(input).observations[0]?.status).toBe('inside-single-cavity')
  })

  it('holds an outboard caption instead of assigning the nearest cavity', () => {
    const input = fixture()
    const { item } = itemOf(input)
    item.quad = item.quad.map(({ x, y }) => ({ x: x + 400, y })) as typeof item.quad
    item.baselineStart.x += 400
    item.baselineEnd.x += 400
    const label = input.native.labels[0]
    if (!label?.pagePoint) throw new Error('Missing caption')
    label.point.x += 400
    label.pagePoint.x += 400
    expect(nativeHeightSourceLocations(input).observations).toMatchObject([
      { status: 'unresolved', cavityIds: [], reason: 'outboard-height-caption-leader-unverified' },
    ])
  })

  it('keeps competing full source cavities rather than picking one', () => {
    const input = fixture()
    const floor = floors.nativeFloorCavityCandidates(input)
    const cell = floor.cavities[0]
    if (!cell) throw new Error('Missing floor')
    floor.cavities.push({ ...structuredClone(cell), id: 'other-cavity' })
    vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(floor)
    expect(nativeHeightSourceLocations(input).observations[0]).toMatchObject({
      status: 'ambiguous',
      cavityIds: ['native-floor-cavity-1', 'other-cavity'],
      reason: 'competing-height-caption-cavities',
    })
  })

  it.each(['whole-boundary', 'caption-curve', 'unproved-region'])(
    'does not promote source locations through %s omissions',
    (kind) => {
      const input = fixture()
      const floor = floors.nativeFloorCavityCandidates(input)
      const cell = floor.cavities[0]
      if (!cell) throw new Error('Missing floor')
      if (kind === 'whole-boundary') cell.omittedBoundaryInkCount = 1
      if (kind === 'caption-curve') {
        input.work.skippedCurves = 1
        input.work.skippedCurveBounds = [
          { operationIndex: 99, bounds: { left: 130, right: 140, top: 120, bottom: 130 } },
        ]
      }
      if (kind === 'unproved-region')
        floor.unprovedCavities.push({
          polygon: null,
          bounds: { left: 130, right: 140, top: 120, bottom: 130 },
          vertexCount: 4,
          reason: 'unproved',
        })
      vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(floor)
      expect(nativeHeightSourceLocations(input).observations[0]?.status).toBe('unresolved')
    },
  )

  it('retains unavailable glyphs as source rows without inventing an ink envelope', () => {
    const input = fixture()
    const { ink } = itemOf(input)
    ink.items = []
    ink.complete = false
    ink.unresolved = [{ index: 0, reason: 'unsupported-native-text-ink-text' }]
    expect(nativeHeightSourceLocations(input).observations).toMatchObject([
      {
        status: 'unresolved',
        inkSourceOperation: null,
        cavityIds: [],
        reason: 'height-caption-ink-unverified',
      },
    ])
  })

  it.each([
    'source',
    'source-null',
    'page',
    'width',
    'index',
    'missing',
    'duplicate',
    'item-null',
    'quad-null',
    'point-null',
    'baseline-null',
    'baseline-zero',
    'baseline-angle',
    'quad-shape',
    'text',
    'visibility',
  ])('refuses invalid %s evidence atomically', (kind) => {
    const input = fixture()
    const { ink, item } = itemOf(input)
    if (kind === 'source') ink.source.sha256 = 'c'.repeat(64)
    if (kind === 'source-null') Object.assign(ink, { source: null })
    if (kind === 'page') ink.source.pdfPage++
    if (kind === 'width') ink.source.pageWidth++
    if (kind === 'index') item.index++
    if (kind === 'missing') ink.items = []
    if (kind === 'duplicate') ink.items.push(structuredClone(item))
    if (kind === 'item-null') Object.assign(ink.items, { 0: null })
    if (kind === 'quad-null') Object.assign(item, { quad: null })
    if (kind === 'point-null') Object.assign(item.quad, { 0: null })
    if (kind === 'baseline-null') Object.assign(item, { baselineStart: null })
    if (kind === 'baseline-zero') item.baselineEnd = { ...item.baselineStart }
    if (kind === 'baseline-angle') item.baselineEnd.y++
    if (kind === 'quad-shape') item.quad[2].x++
    if (kind === 'text') item.text = 'other text'
    if (kind === 'visibility') input.native.vectorInkRefusal = 'hidden-native-vector-layer'
    const report = nativeHeightSourceLocations(input)
    expect(report.status).toBe('unresolved')
    expect(report.observations).toEqual([])
  })

  it('clears all source locations when bounded work is exhausted', () => {
    const input = fixture()
    const { ink, item } = itemOf(input)
    const label = input.native.labels[0]
    const floor = floors.nativeFloorCavityCandidates(input)
    const cell = floor.cavities[0]
    if (!label || !cell) throw new Error('Missing fixture')
    input.native.labels = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(label),
      id: `native-text-${index}`,
      nativeIndex: index,
    }))
    ink.items = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(item),
      index,
      operationIndex: 100 + index,
    }))
    floor.cavities = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(cell),
      id: `cavity-${index}`,
    }))
    vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(floor)
    expect(nativeHeightSourceLocations(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'height-location-work-limit',
      observations: [],
    })
  })
})
