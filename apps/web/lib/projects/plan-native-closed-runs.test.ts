import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeClosedStrokeRuns } from './plan-native-closed-runs'
import type { Bounds, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const raster = { sha256: 'b'.repeat(64), page: 1, width: 1000, height: 1000 }
const anchors: NativeTextAnchors = {
  source: raster,
  originalPdfSha256: 'a'.repeat(64),
  complete: true,
  labels: [],
  pageNormalizedScale: { x: 1, y: 1 },
}

function path(
  operationIndex = 11,
  points = [
    [100, 100],
    [300, 100],
    [300, 300],
    [100, 300],
  ],
  closed = true,
): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed,
    points: points.map(([x, y]) => ({ x: x as number, y: y as number })),
  }
}
function work(paths = [path()]): PdfLinework {
  return {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    truncated: false,
  }
}
function input(layer = work(), native = anchors) {
  return { native, work: layer, lineworkSource: native.source }
}
const run = (layer = work(), native = anchors) => nativeClosedStrokeRuns(input(layer, native))
function omit(layer: PdfLinework, kind: 'curve' | 'clip', operationIndex: number, bounds: Bounds) {
  if (kind === 'curve') {
    layer.skippedCurves++
    layer.skippedCurveBounds ??= []
    layer.skippedCurveBounds.push({ operationIndex, bounds })
  } else {
    layer.clippedPaths++
    layer.clippedPathBounds ??= []
    layer.clippedPathBounds.push({ operationIndex, bounds })
  }
}
function prefixedLoop() {
  return path(
    77,
    [
      [50, 100],
      [100, 100],
      [150, 100],
      [200, 100],
      [250, 100],
      [300, 100],
      [300, 150],
      [300, 200],
      [300, 250],
      [250, 250],
      [200, 250],
      [150, 250],
      [100, 250],
      [100, 200],
      [100, 175],
      [100, 150],
      [100, 100],
    ],
    false,
  )
}

describe('literal native closed stroke runs', () => {
  it('uses the real closing command and preserves source order, references and unclassified readiness', () => {
    const layer = work()
    const result = run(layer)
    expect(result.status).toBe('draft')
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    expect(candidate?.sourceKind).toBe('closed-path')
    expect(candidate?.polygon).toEqual(layer.paths[0]?.points)
    expect(candidate?.edges).toEqual([
      {
        operationIndex: 11,
        subpathIndex: 0,
        segmentIndex: 0,
        start: { x: 100, y: 100 },
        end: { x: 300, y: 100 },
      },
      {
        operationIndex: 11,
        subpathIndex: 0,
        segmentIndex: 1,
        start: { x: 300, y: 100 },
        end: { x: 300, y: 300 },
      },
      {
        operationIndex: 11,
        subpathIndex: 0,
        segmentIndex: 2,
        start: { x: 300, y: 300 },
        end: { x: 100, y: 300 },
      },
      {
        operationIndex: 11,
        subpathIndex: 0,
        segmentIndex: 3,
        start: { x: 100, y: 300 },
        end: { x: 100, y: 100 },
      },
    ])
    expect(candidate?.remainingSegments).toEqual([])
    expect(result).toMatchObject({
      source: raster,
      originalPdfSha256: anchors.originalPdfSha256,
      readOnly: true,
      closesFloorBoundary: false,
    })
  })
  it('does not append a zero implicit edge after an explicit return', () => {
    const source = path(72, [
      [100, 100],
      [300, 100],
      [300, 300],
      [100, 300],
      [100, 100],
    ])
    const result = run(work([source]))
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.edges.map(({ segmentIndex }) => segmentIndex)).toEqual([
      0, 1, 2, 3,
    ])
    expect(result.candidates[0]?.polygon).toEqual(source.points.slice(0, -1))
    expect(result.candidates[0]?.repaintAliases).toBeUndefined()
  })
  it('extracts an actual 15-edge literal run and retains its prefix without changing path.closed', () => {
    const source = prefixedLoop()
    const layer = work([source])
    const snapshot = structuredClone(layer)
    const result = run(layer)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.sourceKind).toBe('literal-closed-run')
    expect(result.candidates[0]?.polygon).toEqual(source.points.slice(1, 16))
    expect(result.candidates[0]?.edges.map(({ segmentIndex }) => segmentIndex)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    )
    expect(result.candidates[0]?.remainingSegments).toEqual([
      {
        operationIndex: 77,
        subpathIndex: 0,
        segmentIndex: 0,
        start: { x: 50, y: 100 },
        end: { x: 100, y: 100 },
      },
    ])
    expect(layer).toEqual(snapshot)
    expect(source.closed).toBe(false)
  })
  it('retains prefixes and suffixes, not a closed-path flag or fabricated return', () => {
    const source = path(
      9,
      [
        [50, 100],
        [100, 100],
        [300, 100],
        [300, 300],
        [100, 300],
        [100, 100],
        [75, 200],
      ],
      false,
    )
    const result = run(work([source]))
    expect(result.candidates[0]?.remainingSegments.map(({ segmentIndex }) => segmentIndex)).toEqual(
      [0, 5],
    )
    expect(result.candidates[0]?.edges.map(({ segmentIndex }) => segmentIndex)).toEqual([
      1, 2, 3, 4,
    ])
  })
  it('returns all competing simple literal loops rather than choosing the first or longest', () => {
    const source = path(
      36,
      [
        [100, 100],
        [200, 100],
        [150, 200],
        [100, 100],
        [50, 100],
        [75, 50],
        [100, 100],
      ],
      false,
    )
    const result = run(work([source]))
    expect(result.candidates).toHaveLength(2)
    expect(
      result.candidates.map((candidate) => candidate.edges.map(({ segmentIndex }) => segmentIndex)),
    ).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ])
    expect(
      result.candidates.map((candidate) =>
        candidate.remainingSegments.map(({ segmentIndex }) => segmentIndex),
      ),
    ).toEqual([
      [3, 4, 5],
      [0, 1, 2],
    ])
    expect(result.rejected.some(({ reason }) => reason === 'non-simple-closed-run')).toBe(true)
  })
  it.each(['stroke', 'fill', 'fill-stroke'] as const)(
    'uses %s paint without treating fills as an independent wall outline',
    (paint) => {
      const source = path()
      source.paint = paint
      expect(run(work([source])).candidates).toHaveLength(paint === 'stroke' ? 1 : 0)
    },
  )
  it('keeps exact rotation/reverse repaint aliases with their own directed provenance and unselected pieces', () => {
    const first = path(18)
    const alias = path(29, [
      [300, 300],
      [300, 100],
      [100, 100],
      [100, 300],
    ])
    const prefixed = path(
      39,
      [
        [400, 300],
        [300, 300],
        [300, 100],
        [100, 100],
        [100, 300],
        [300, 300],
      ],
      false,
    )
    const result = run(work([first, alias, prefixed]))
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    expect(candidate?.polygon).toEqual(first.points)
    expect(candidate?.edges[0]?.operationIndex).toBe(18)
    expect(candidate?.repaintAliases).toHaveLength(2)
    expect(candidate?.repaintAliases?.[0]?.edges[0]).toMatchObject({
      operationIndex: 29,
      segmentIndex: 0,
      start: alias.points[0],
      end: alias.points[1],
    })
    expect(
      candidate?.repaintAliases?.[1]?.remainingSegments.map(({ segmentIndex }) => segmentIndex),
    ).toEqual([0])
    expect(candidate?.repaintAliases?.[1]?.sourceKind).toBe('literal-closed-run')
  })
  it('does not deduplicate a near repaint or discard original collinear segment cuts', () => {
    const first = path()
    const near = path(21, [
      [100.000001, 100],
      [300, 100],
      [300, 300],
      [100, 300],
    ])
    const cuts = path(31, [
      [100, 100],
      [200, 100],
      [300, 100],
      [300, 300],
      [100, 300],
    ])
    expect(run(work([first, near, cuts])).candidates).toHaveLength(3)
  })
  it.each(
    [
      [
        [100, 100],
        [300, 100],
        [300, 300],
        [100, 300],
      ],
      [
        [100, 100],
        [300, 100],
        [300, 300],
        [100, 300],
        [100.000001, 100],
      ],
      [
        [100, 100],
        [300, 300],
        [100, 300],
        [300, 100],
        [100, 100],
      ],
      [
        [100, 100],
        [200, 100],
        [300, 100],
        [100, 100],
      ],
    ].map((points) => [points]),
  )(
    'never adds a missing/near return or accepts a self-crossing or degenerate source run',
    (points) => {
      expect(run(work([path(32, points, false)])).candidates).toEqual([])
    },
  )
  it('does not skip repeated zero edges to manufacture a whole path, but keeps a literal nonzero subrun and its zero prefix', () => {
    const source = path(17, [
      [100, 100],
      [100, 100],
      [300, 100],
      [300, 300],
      [100, 300],
      [100, 100],
    ])
    const result = run(work([source]))
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.sourceKind).toBe('literal-closed-run')
    expect(result.candidates[0]?.edges.map(({ segmentIndex }) => segmentIndex)).toEqual([
      1, 2, 3, 4,
    ])
    expect(result.candidates[0]?.remainingSegments[0]).toMatchObject({
      segmentIndex: 0,
      start: { x: 100, y: 100 },
      end: { x: 100, y: 100 },
    })
  })
  it('does not expose mutable source points, evidence arrays, aliases or source frame references', () => {
    const layer = work([path(), path(30)])
    const request = input(layer)
    const snapshot = structuredClone(request)
    const result = nativeClosedStrokeRuns(request)
    const candidate = result.candidates[0]
    if (!candidate?.polygon[0] || !candidate.edges[0]) throw new Error('Closed run is missing')
    candidate.polygon[0].x = 999
    candidate.edges[0].end.y = 888
    candidate.repaintAliases?.[0]?.edges.pop()
    result.source.width = 333
    expect(request).toEqual(snapshot)
  })
  it.each(['curve', 'clip'] as const)(
    'holds a %s-omitted operation sibling without hiding unrelated source loops',
    (kind) => {
      const layer = work([
        path(11),
        path(31, [
          [500, 500],
          [600, 500],
          [600, 600],
          [500, 600],
        ]),
      ])
      omit(layer, kind, 11, { left: 800, right: 810, top: 800, bottom: 810 })
      const result = run(layer)
      expect(result.status).toBe('draft')
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]?.edges[0]?.operationIndex).toBe(31)
      expect(result.conflictedCandidates).toEqual([])
      expect(result.rejected).toContainEqual({
        id: 'native-closed-run-11:0',
        reason: 'omitted-operation-sibling',
      })
    },
  )
  it.each(['curve', 'clip'] as const)(
    'allows unrelated and strictly interior %s bounds, without zeroing omission counts',
    (kind) => {
      const layer = work()
      omit(layer, kind, 70, { left: 150, right: 200, top: 150, bottom: 200 })
      omit(layer, kind, 80, { left: 800, right: 810, top: 800, bottom: 810 })
      const snapshot = structuredClone(layer)
      expect(run(layer).candidates).toHaveLength(1)
      expect(layer).toEqual(snapshot)
    },
  )
  it.each(['curve', 'clip'] as const)(
    'rejects boundary contact with diagnostic %s bounds, even a point contact',
    (kind) => {
      const layer = work()
      omit(layer, kind, 70, { left: 100, right: 100, top: 200, bottom: 200 })
      const result = run(layer)
      expect(result.candidates).toEqual([])
      expect(result.conflictedCandidates).toHaveLength(1)
      expect(result.conflictedCandidates[0]?.boundaryOmissions).toEqual([
        { kind, operationIndex: 70, bounds: { left: 100, right: 100, top: 200, bottom: 200 } },
      ])
      expect(result.rejected[0]?.reason).toBe('omitted-ink-touches-boundary')
    },
  )
  it('retains multiple touching omissions once each and separates observed closure from any physical-floor claim', () => {
    const layer = work([path(), path(40)])
    omit(layer, 'curve', 70, { left: 99, right: 150, top: 99, bottom: 150 })
    omit(layer, 'clip', 71, { left: 200, right: 220, top: 300, bottom: 310 })
    const snapshot = structuredClone(layer)
    const result = run(layer)
    expect(result.candidates).toEqual([])
    expect(result.conflictedCandidates).toHaveLength(1)
    const conflicted = result.conflictedCandidates[0]
    expect(conflicted?.boundaryOmissions).toHaveLength(2)
    expect(conflicted?.repaintAliases).toHaveLength(1)
    expect(conflicted?.edges).toHaveLength(4)
    expect(result.closesFloorBoundary).toBe(false)
    if (!conflicted?.boundaryOmissions[0]) throw new Error('Boundary omission is missing')
    conflicted.boundaryOmissions[0].bounds.left = 999
    expect(layer).toEqual(snapshot)
  })
  it('bounds touching omission evidence and clears both candidate collections on refusal', () => {
    const layer = work([
      path(20, [
        [500, 500],
        [600, 500],
        [600, 600],
        [500, 600],
      ]),
      path(),
    ])
    for (let index = 0; index < 101; index++)
      omit(layer, 'curve', 100 + index, { left: 100, right: 100, top: 200, bottom: 200 })
    const result = run(layer)
    expect(result.refusalReason).toBe('boundary-omission-limit')
    expect(result.candidates).toEqual([])
    expect(result.conflictedCandidates).toEqual([])
  })
  it('tests diagonal boundaries against the actual box rather than the polygon bounding box', () => {
    const layer = work([
      path(11, [
        [100, 100],
        [300, 100],
        [100, 300],
      ]),
    ])
    omit(layer, 'curve', 70, { left: 250, right: 260, top: 250, bottom: 260 })
    expect(run(layer).candidates).toHaveLength(1)
    omit(layer, 'curve', 71, { left: 190, right: 210, top: 190, bottom: 210 })
    expect(run(layer).candidates).toEqual([])
  })
  it('handles omission bounds outside the page without an out-of-domain geometry claim', () => {
    const layer = work()
    omit(layer, 'clip', 70, { left: -300, right: -200, top: 100, bottom: 150 })
    expect(run(layer).candidates).toHaveLength(1)
    omit(layer, 'clip', 71, { left: -10, right: 500, top: 99, bottom: 101 })
    expect(run(layer).candidates).toEqual([])
  })
  it('keeps independent straight operation siblings and their subpath indices', () => {
    const first = path(11)
    const second = path(11, [
      [500, 500],
      [600, 500],
      [600, 600],
      [500, 600],
    ])
    second.subpathIndex = 1
    const result = run(work([first, second]))
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[1]?.edges.every(({ subpathIndex }) => subpathIndex === 1)).toBe(true)
  })
  it.each([
    'source-hash',
    'source-page',
    'source-width',
    'pdf-hash',
    'scale',
    'scale-mismatch',
    'coordinate-system',
    'page-dimension',
    'truncated',
    'unsupported-path',
    'unsupported-context',
    'path-limit',
    'point-limit',
    'duplicate-ref',
    'negative-op',
    'fractional-subpath',
    'closed-flag',
    'paint',
    'missing-point',
    'outside-point',
    'nonfinite-point',
    'precision',
    'missing-curve-bounds',
    'missing-clip-bounds',
    'curve-count',
    'clip-count',
    'truncated-curve-bounds',
    'truncated-clip-bounds',
    'null-bounds',
    'reversed-bounds',
    'nonfinite-bounds',
    'negative-omission-op',
    'curve-array',
    'curve-refs',
    'unknown-curve-operation',
  ])('refuses invalid or incomplete source evidence atomically: %s', (change) => {
    const request = structuredClone(input())
    const source = request.work.paths[0]
    if (!source) throw new Error('Source path is missing')
    if (change === 'source-hash')
      request.lineworkSource = { ...request.lineworkSource, sha256: 'f'.repeat(64) }
    if (change === 'source-page') request.lineworkSource = { ...request.lineworkSource, page: 2 }
    if (change === 'source-width')
      request.lineworkSource = { ...request.lineworkSource, width: 999 }
    if (change === 'pdf-hash') request.native.originalPdfSha256 = 'bad'
    if (change === 'scale') Object.assign(request.native, { pageNormalizedScale: undefined })
    if (change === 'scale-mismatch') request.native.pageNormalizedScale = { x: 0.8, y: 1 }
    if (change === 'coordinate-system') Object.assign(request.work, { coordinateSystem: 'cm' })
    if (change === 'page-dimension') request.work.pageHeight = 0
    if (change === 'truncated') request.work.truncated = true
    if (change === 'unsupported-path') request.work.unsupportedPaths = 1
    if (change === 'unsupported-context') request.work.unsupportedContexts = 1
    if (change === 'path-limit') request.work.paths = Array(3001).fill(source)
    if (change === 'point-limit') source.points = Array(20001).fill(source.points[0])
    if (change === 'duplicate-ref') request.work.paths.push(structuredClone(source))
    if (change === 'negative-op') source.operationIndex = -1
    if (change === 'fractional-subpath') source.subpathIndex = 0.5
    if (change === 'closed-flag') Object.assign(source, { closed: 'yes' })
    if (change === 'paint') Object.assign(source, { paint: 'outline' })
    if (change === 'missing-point') Object.assign(source.points, { 1: null })
    if (change === 'outside-point' && source.points[0]) source.points[0].x = 1001
    if (change === 'nonfinite-point' && source.points[0]) source.points[0].y = NaN
    if (change === 'precision' && source.points[0]) source.points[0].x = 1e-19
    if (change === 'missing-curve-bounds') request.work.skippedCurves = 1
    if (change === 'missing-clip-bounds') request.work.clippedPaths = 1
    if (change === 'curve-count') request.work.skippedCurves = -1
    if (change === 'clip-count') request.work.clippedPaths = 0.5
    if (change === 'truncated-curve-bounds') request.work.skippedCurveBoundsTruncated = true
    if (change === 'truncated-clip-bounds') request.work.clippedPathBoundsTruncated = true
    if (
      ['null-bounds', 'reversed-bounds', 'nonfinite-bounds', 'negative-omission-op'].includes(
        change,
      )
    ) {
      omit(request.work, 'curve', 70, { left: 800, right: 810, top: 800, bottom: 810 })
      const omission = request.work.skippedCurveBounds?.[0]
      if (!omission) throw new Error('Omission fixture is missing')
      if (change === 'null-bounds') Object.assign(omission, { bounds: null })
      if (change === 'reversed-bounds') omission.bounds.right = 700
      if (change === 'nonfinite-bounds') omission.bounds.top = NaN
      if (change === 'negative-omission-op') omission.operationIndex = -1
    }
    if (change === 'curve-array') Object.assign(request.work, { curvePaths: {} })
    if (change === 'curve-refs' || change === 'unknown-curve-operation') {
      omit(request.work, 'curve', 70, { left: 800, right: 810, top: 800, bottom: 810 })
      request.work.curvePaths = [
        {
          operationIndex: change === 'curve-refs' ? 11 : 71,
          subpathIndex: 0,
          operationSubpathCount: 1,
          paint: 'stroke',
          closed: false,
          start: { x: 800, y: 800 },
          segments: [{ kind: 'line', end: { x: 810, y: 810 } }],
        },
      ]
    }
    const snapshot = structuredClone(request)
    const result = nativeClosedStrokeRuns(request)
    expect(result.status).toBe('unresolved')
    expect(result.refusalReason).toBeTruthy()
    expect(result.candidates).toEqual([])
    expect(result.conflictedCandidates).toEqual([])
    expect(request).toEqual(snapshot)
  })
  it('accepts 100 source proofs but refuses the 101st even if all are repaint aliases', () => {
    const hundred = Array.from({ length: 100 }, (_, index) => path(index + 1))
    const accepted = run(work(hundred))
    expect(accepted.candidates).toHaveLength(1)
    expect(accepted.candidates[0]?.repaintAliases).toHaveLength(99)
    const refused = run(work([...hundred, path(101)]))
    expect(refused.refusalReason).toBe('candidate-limit')
    expect(refused.candidates).toEqual([])
    expect(refused.conflictedCandidates).toEqual([])
  })
  it('applies a neutral minimum-edge filter before counting candidate or repaint evidence', () => {
    const rectangles = Array.from({ length: 101 }, (_, index) => path(index + 1))
    const loop = prefixedLoop()
    loop.operationIndex = 500
    const layer = work([...rectangles, loop])
    const filtered = nativeClosedStrokeRuns({ ...input(layer), minimumEdges: 6 })
    expect(filtered.status).toBe('draft')
    expect(filtered.candidates).toHaveLength(1)
    expect(filtered.candidates[0]?.edges).toHaveLength(15)
    expect(filtered.candidates[0]?.sourceKind).toBe('literal-closed-run')
    expect(filtered.closesFloorBoundary).toBe(false)
    expect(run(layer).refusalReason).toBe('candidate-limit')
  })
  it.each([2, 101, 3.5, NaN, '6', null])(
    'refuses invalid minimum-edge filters: %s',
    (minimumEdges) => {
      const request = input()
      Object.assign(request, { minimumEdges })
      const result = nativeClosedStrokeRuns(request)
      expect(result.refusalReason).toBe('invalid-closed-run-size-filter')
      expect(result.candidates).toEqual([])
      expect(result.conflictedCandidates).toEqual([])
    },
  )
  it('applies the same 100-source-proof budget across clean and conflicted runs', () => {
    const clean = Array.from({ length: 99 }, (_, index) => path(index + 1))
    const conflict = path(500, [
      [500, 500],
      [600, 500],
      [600, 600],
      [500, 600],
    ])
    const layer = work([...clean, conflict])
    omit(layer, 'curve', 999, { left: 500, right: 500, top: 550, bottom: 550 })
    const accepted = run(layer)
    expect(accepted.candidates).toHaveLength(1)
    expect(accepted.conflictedCandidates).toHaveLength(1)
    layer.paths.push(
      path(501, [
        [500, 500],
        [600, 500],
        [600, 600],
        [500, 600],
      ]),
    )
    const refused = run(layer)
    expect(refused.refusalReason).toBe('candidate-limit')
    expect(refused.candidates).toEqual([])
    expect(refused.conflictedCandidates).toEqual([])
  })
  it('bounds repeated-vertex search work and refuses partial results atomically', () => {
    const dense = path(
      22,
      Array.from({ length: 1000 }, () => [800, 800]),
      false,
    )
    const result = run(work([path(), dense]))
    expect(result.refusalReason).toBe('closed-run-search-budget')
    expect(result.candidates).toEqual([])
    expect(result.conflictedCandidates).toEqual([])
    expect(result.rejected.length).toBeLessThanOrEqual(100)
  })
})
