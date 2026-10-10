import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { nativeDimensionTargets } from './plan-native-dimension-targets'
import * as floors from './plan-native-floor-cavities'
import type { PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeDimensionTargets>[0]
function path(
  operationIndex: number,
  points: number[][],
  paint: PdfVectorPath['paint'] = 'stroke',
  closed = false,
): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint,
    closed,
    ...(paint === 'stroke' ? {} : { fillColor: '#736a5d' }),
    points: points.map(([x, y]) => ({ x: x as number, y: y as number })),
  }
}
function box(operation: number, left: number, top: number, right: number, bottom: number) {
  return path(
    operation,
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
    'fill-stroke',
    true,
  )
}
function fixture(): Input {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const raster = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  return {
    source,
    lineworkSource: { ...raster },
    native: {
      source: raster,
      originalPdfSha256: source.sha256,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-10',
          nativeIndex: 10,
          compactIndex: 0,
          name: '200',
          rotation: 0,
          point: { x: 191, y: 78 },
          pagePoint: { x: 191, y: 78 },
        },
      ],
      compactCaptionGeometry: {
        source: { sha256: source.sha256, pdfPage: 1, pageWidth: 1000, pageHeight: 1000 },
        complete: true,
        items: [
          {
            index: 0,
            text: '200',
            rotation: 0,
            origin: { x: 191, y: 78 },
            baselineStart: { x: 191, y: 78 },
            baselineEnd: { x: 209, y: 78 },
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
        path(1, [
          [100, 80],
          [300, 80],
        ]),
        path(2, [
          [95, 85],
          [105, 75],
        ]),
        path(3, [
          [295, 85],
          [305, 75],
        ]),
        path(4, [
          [100, 70],
          [100, 100],
        ]),
        path(5, [
          [300, 70],
          [300, 100],
        ]),
        // A literal L-shaped painted enclosure. Only its complete top side has
        // the rail's endpoints; no chosen room contour or inferred scale.
        box(10, 90, 90, 100, 310),
        box(11, 300, 90, 310, 260),
        box(12, 100, 90, 300, 100),
        box(13, 250, 250, 300, 260),
        box(14, 250, 260, 260, 310),
        box(15, 100, 300, 250, 310),
      ],
    },
  }
}
function sourcePath(input: Input, operation: number) {
  const result = input.work.paths.find(({ operationIndex }) => operationIndex === operation)
  if (!result) throw new Error('Missing synthetic source path')
  return result
}
function first(result: ReturnType<typeof nativeDimensionTargets>) {
  const observation = result.observations[0]
  if (!observation) throw new Error(`Missing observation: ${JSON.stringify(result)}`)
  return observation
}
function frameFixture() {
  const input = fixture()
  input.work.paths = input.work.paths.filter(({ operationIndex }) => operationIndex < 10)
  input.work.paths.push(
    path(
      20,
      [
        [100, 100],
        [300, 100],
        [300, 110],
        [100, 110],
        [100, 100],
      ],
      'stroke',
      true,
    ),
    path(
      21,
      [
        [50, 90],
        [100, 90],
        [100, 120],
        [50, 120],
        [45, 115],
        [45, 105],
      ],
      'stroke',
      true,
    ),
    path(
      22,
      [
        [300, 90],
        [350, 90],
        [355, 105],
        [355, 115],
        [350, 120],
        [300, 120],
      ],
      'stroke',
      true,
    ),
  )
  return input
}
afterEach(() => vi.restoreAllMocks())

describe('literal source dimensions associated with whole floor/frame targets', () => {
  it('rebuilds a whole boundary and two continuous witnesses without model acceptance', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeDimensionTargets(input, nativeCaptionBindings(input))
    expect(result).toMatchObject({
      status: 'draft',
      refusalReason: null,
      readOnly: true,
      roomOwnershipConfirmed: false,
      physicalPassagesAccepted: false,
      mayTransfer2D: false,
      mayTransfer3D: false,
    })
    expect(first(result)).toMatchObject({
      labelId: 'native-text-10',
      valueMm: 200,
      axis: 'width',
      status: 'continuous',
      reason: null,
      targets: [
        {
          kind: 'floor-boundary',
          faces: [
            {
              status: 'continuous',
              endpointWitnesses: [
                { status: 'continuous', gapPoints: 0 },
                { status: 'continuous', gapPoints: 0 },
              ],
            },
          ],
        },
      ],
    })
    expect(
      first(result).targets[0]?.faces[0]?.endpointWitnesses.map(
        ({ sourceRefs }) => sourceRefs[0]?.operationIndex,
      ),
    ).toEqual([4, 5])
    expect(input).toEqual(before)
    const copied = first(result).targets[0]?.faces[0]?.supportRefs[0]
    if (copied) copied.operationIndex = 9999
    expect(input).toEqual(before)
    for (const key of ['geometry', 'footprint', 'cmPerPoint', 'widthCm', 'roomId', 'openingKind'])
      expect(result).not.toHaveProperty(key)
  })

  it('associates a cardinal vertical caption with literal original-page target endpoints', () => {
    const input = fixture()
    const rotate = (point: { x: number; y: number }) => ({ x: point.y, y: 1000 - point.x })
    for (const path of input.work.paths) path.points = path.points.map(rotate)
    const label = input.native.labels[0]
    const caption = input.native.compactCaptionGeometry?.items[0]
    if (!label?.pagePoint || !caption) throw new Error('Missing native caption')
    label.rotation = 90
    label.point = rotate(label.point)
    label.pagePoint = rotate(label.pagePoint)
    caption.rotation = 90
    caption.origin = rotate(caption.origin)
    caption.baselineStart = rotate(caption.baselineStart)
    caption.baselineEnd = rotate(caption.baselineEnd)
    expect(first(nativeDimensionTargets(input))).toMatchObject({
      axis: 'depth',
      status: 'continuous',
      targets: [{ kind: 'floor-boundary' }],
    })
  })

  it('does not promote a strictly proved slanted source rail to a cardinal target', () => {
    const input = fixture()
    const radians = Math.PI / 4
    const rotate = (point: { x: number; y: number }) => ({
      x: 200 + (point.x - 200) * Math.cos(radians) + (point.y - 200) * Math.sin(radians),
      y: 200 - (point.x - 200) * Math.sin(radians) + (point.y - 200) * Math.cos(radians),
    })
    for (const path of input.work.paths) path.points = path.points.map(rotate)
    const label = input.native.labels[0]
    const caption = input.native.compactCaptionGeometry?.items[0]
    if (!label?.pagePoint || !caption) throw new Error('Missing native caption')
    label.rotation = 45
    label.point = rotate(label.point)
    label.pagePoint = rotate(label.pagePoint)
    caption.rotation = 45
    caption.baselineStart = rotate(caption.baselineStart)
    caption.baselineEnd = rotate(caption.baselineEnd)
    caption.origin = {
      x: Math.round(caption.baselineStart.x),
      y: Math.round(caption.baselineStart.y),
    }
    expect(first(nativeDimensionTargets(input))).toMatchObject({
      axis: 'aligned',
      status: 'unresolved',
      reason: 'non-cardinal-source-target-not-supported',
      targets: [],
    })
  })

  it('re-proves a whole side with several contiguous literal paint supports', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter(({ operationIndex }) => operationIndex !== 12)
    input.work.paths.push(box(12, 100, 90, 200, 100), box(16, 200, 90, 300, 100))
    const row = first(nativeDimensionTargets(input))
    expect(row.status).toBe('continuous')
    expect(
      row.targets[0]?.faces[0]?.supportRefs.map(({ operationIndex }) => operationIndex),
    ).toEqual([12, 16])
  })

  it('does not accept an incomplete floor boundary with a positive 1e-9 source support gap', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter(({ operationIndex }) => operationIndex !== 12)
    input.work.paths.push(box(12, 100, 90, 200, 100), box(16, 200 + 1e-9, 90, 300, 100))
    const row = first(nativeDimensionTargets(input))
    expect(row.status).toBe('unresolved')
    expect(row.targets).toEqual([])
  })

  it.each([1.77, 1e-9])(
    'retains a positive %s-point endpoint gap instead of bridging it',
    (gap) => {
      const input = fixture()
      for (const operation of [4, 5]) {
        const endpoint = sourcePath(input, operation).points[1]
        if (!endpoint) throw new Error('Missing synthetic witness endpoint')
        endpoint.y -= gap
      }
      const row = first(nativeDimensionTargets(input))
      expect(row.status).toBe('detached')
      expect(row.reason).toBe('detached-source-extension')
      for (const witness of row.targets[0]?.faces[0]?.endpointWitnesses ?? []) {
        expect(witness.status).toBe('detached')
        expect(witness.gapPoints).toBeGreaterThan(0)
        expect(witness.gapPoints).toBeCloseTo(gap, 7)
      }
    },
  )

  it('does not invent a connection where an endpoint has no source stroke', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter(({ operationIndex }) => operationIndex !== 5)
    expect(first(nativeDimensionTargets(input))).toMatchObject({
      status: 'unresolved',
      reason: 'missing-bounded-endpoint-witness',
    })
  })

  it('holds competing differently bounded endpoint strokes rather than choosing one', () => {
    const input = fixture()
    input.work.paths.push(
      path(30, [
        [100, 65],
        [100, 105],
      ]),
    )
    expect(first(nativeDimensionTargets(input))).toMatchObject({
      status: 'ambiguous',
      reason: 'competing-endpoint-witnesses',
    })
  })

  it('does not let a continuous witness hide a distinct detached extension', () => {
    const input = fixture()
    input.work.paths.push(
      path(30, [
        [100, 65],
        [100, 98.23],
      ]),
    )
    const row = first(nativeDimensionTargets(input))
    expect(row).toMatchObject({
      status: 'ambiguous',
      reason: 'competing-endpoint-witnesses',
    })
    expect(
      row.targets[0]?.faces[0]?.endpointWitnesses[0].sourceRefs.map(
        ({ operationIndex }) => operationIndex,
      ),
    ).toEqual([4, 30])
  })

  it('retains exact witness repaint aliases and gives source order no authority', () => {
    const input = fixture()
    input.work.paths.push({ ...structuredClone(sourcePath(input, 4)), operationIndex: 30 })
    const result = nativeDimensionTargets(input)
    expect(first(result).status).toBe('continuous')
    expect(
      first(result).targets[0]?.faces[0]?.endpointWitnesses[0].sourceRefs.map(
        ({ operationIndex }) => operationIndex,
      ),
    ).toEqual([4, 30])
    const reversed = structuredClone(input)
    reversed.work.paths.reverse()
    expect(nativeDimensionTargets(reversed)).toEqual(result)
  })

  it.each([0.095, 1e-9])(
    'does not project a %s-point endpoint mismatch onto a different target',
    (offset) => {
      const input = fixture()
      // Same failure mode as source y82.233 versus y82.328: change both literal
      // right boundary and its support, not a cached or rounded target.
      for (const path of input.work.paths)
        if (path.operationIndex >= 10)
          for (const point of path.points) if (point.x === 300) point.x += offset
      const row = first(nativeDimensionTargets(input))
      expect(row).toMatchObject({
        status: 'unresolved',
        reason: 'no-exact-whole-source-target',
        targets: [],
      })
    },
  )

  it('requires a complete fresh source enclosure, not a partial support selected by the caller', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter(({ operationIndex }) => operationIndex !== 12)
    expect(first(nativeDimensionTargets(input))).toMatchObject({
      status: 'unresolved',
      targets: [],
    })
  })

  it('does not turn the two long sides of one frame into two accepted openings', () => {
    const input = frameFixture()
    const row = first(nativeDimensionTargets(input))
    expect(row).toMatchObject({
      status: 'ambiguous',
      reason: 'source-target-face-alternatives',
      targets: [
        {
          kind: 'opening-frame',
          id: 'native-opening-frame-20:0',
          faces: [{ status: 'continuous' }, { status: 'detached' }],
        },
      ],
    })
    expect(row.targets).toHaveLength(1)
    expect(row.targets[0]?.faces.map(({ edgeIndex }) => edgeIndex)).toEqual([0, 2])
    const refs = row.targets[0]?.faces[0]?.supportRefs ?? []
    expect(refs.some(({ operationIndex }) => operationIndex === 21)).toBe(true)
    expect(refs.some(({ operationIndex }) => operationIndex === 22)).toBe(true)
  })

  it('preserves competing whole target faces even when one has a continuous witness', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter(
      ({ operationIndex }) => ![13, 14, 15].includes(operationIndex),
    )
    input.work.paths.push(box(15, 100, 250, 300, 260))
    const row = first(nativeDimensionTargets(input))
    expect(row.status).toBe('ambiguous')
    expect(row.reason).toBe('source-target-face-alternatives')
    expect(row.targets[0]?.faces).toHaveLength(2)
  })

  it('holds source omissions along the target connection even when the caption rail is clear', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 99, bounds: { left: 195, top: 95, right: 205, bottom: 99 } },
    ]
    expect(first(nativeDimensionTargets(input))).toMatchObject({
      status: 'unresolved',
      reason: 'omitted-ink-near-source-target',
    })
  })

  it.each(['value', 'rail', 'span', 'source', 'flags', 'removed-label'])(
    'rejects a supplied %s proof changed since source verification',
    (change) => {
      const input = fixture()
      const supplied = nativeCaptionBindings(input)
      const binding = supplied.candidates[0] as (typeof supplied.candidates)[number] & {
        spanEnds: [{ x: number; y: number }, { x: number; y: number }]
      }
      if (!binding) throw new Error('Missing synthetic binding')
      if (change === 'value') binding.valueMm += 1
      if (change === 'rail') binding.rail.operationIndex += 1
      if (change === 'span') binding.spanEnds[0].x += 1e-9
      if (change === 'source') supplied.source.pdfPage += 1
      if (change === 'flags') supplied.mayTransfer2D = true as false
      if (change === 'removed-label') input.native.labels = []
      expect(nativeDimensionTargets(input, supplied)).toMatchObject({
        status: 'unresolved',
        refusalReason: 'stale-source-caption-bindings',
        observations: [],
        unresolved: [],
      })
    },
  )

  it.each([
    'truncated',
    'clipped',
    'unlocalized-curve',
    'duplicate-path',
    'foreign-image',
    'planned-state',
  ])('refuses the %s source before association', (change) => {
    const input = fixture()
    if (change === 'truncated') input.work.truncated = true
    if (change === 'clipped') input.work.clippedPaths = 1
    if (change === 'unlocalized-curve') input.work.skippedCurves = 1
    if (change === 'duplicate-path') input.work.paths.push(structuredClone(sourcePath(input, 4)))
    if (change === 'foreign-image') input.lineworkSource.sha256 = 'c'.repeat(64)
    if (change === 'planned-state') input.source.state = 'planned' as 'existing'
    const result = nativeDimensionTargets(input)
    expect(result.status).toBe('unresolved')
    expect(result.observations).toEqual([])
    expect(result.unresolved).toEqual([])
  })

  it('returns atomic empty output when target work exceeds the bounded source association budget', () => {
    const input = fixture()
    const floor = floors.nativeFloorCavityCandidates(input)
    const cell = floor.cavities[0]
    if (!cell) throw new Error('Missing fixture floor')
    const edge = cell.boundaries.find(({ start, end }) => start.y === 100 && end.y === 100)
    if (!edge) throw new Error('Missing complete top boundary')
    const support = edge.supports[0]
    if (!support) throw new Error('Missing synthetic support')
    const huge = structuredClone(floor)
    huge.cavities = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(cell),
      id: `floor-${index}`,
      boundaries: Array.from({ length: 42 }, () => ({
        ...structuredClone(edge),
        supports: Array.from({ length: 500 }, () => support),
      })),
    }))
    vi.spyOn(floors, 'nativeFloorCavityCandidates').mockReturnValue(huge)
    expect(nativeDimensionTargets(input)).toMatchObject({
      status: 'unresolved',
      observations: [],
      unresolved: [],
      refusalReason: 'dimension-target-work-limit',
    })
  })
})
