import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeDoorSymbolCandidates } from './plan-native-door-symbols'
import type { PagePoint, PdfCurvePath, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

type Cubic = Extract<PdfCurvePath['segments'][number], { kind: 'cubic' }>
type Input = Parameters<typeof nativeDoorSymbolCandidates>[0]

const CENTER = { x: 400, y: 400 }
const RADIUS = 100

function circularArc(startAngle: number, endAngle: number, pieces = 1): PdfCurvePath {
  const point = (angle: number): PagePoint => ({
    x: CENTER.x + RADIUS * Math.cos(angle),
    y: CENTER.y + RADIUS * Math.sin(angle),
  })
  const segments: Cubic[] = []
  for (let index = 0; index < pieces; index++) {
    const fromAngle = startAngle + ((endAngle - startAngle) * index) / pieces
    const toAngle = startAngle + ((endAngle - startAngle) * (index + 1)) / pieces
    const start = point(fromAngle)
    const end = point(toAngle)
    const k = (4 / 3) * Math.tan((toAngle - fromAngle) / 4)
    segments.push({
      kind: 'cubic',
      control1: {
        x: start.x - k * (start.y - CENTER.y),
        y: start.y + k * (start.x - CENTER.x),
      },
      control2: {
        x: end.x + k * (end.y - CENTER.y),
        y: end.y - k * (end.x - CENTER.x),
      },
      end,
    })
  }
  return {
    operationIndex: 10,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    strokeColor: '#000000',
    closed: false,
    start: point(startAngle),
    segments,
  }
}

function fixture(options: { pieces?: number; width?: number; height?: number } = {}): Input {
  const frame = {
    sha256: 'a'.repeat(64),
    page: 6,
    width: options.width ?? 1000,
    height: options.height ?? 1000,
  }
  const native: NativeTextAnchors = {
    source: frame,
    originalPdfSha256: 'b'.repeat(64),
    complete: true,
    pageNormalizedScale: { x: frame.width / 1000, y: frame.height / 1000 },
    labels: [],
  }
  const leaf: PdfVectorPath = {
    operationIndex: 20,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points: [structuredClone(CENTER), { x: CENTER.x + RADIUS, y: CENTER.y }],
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: frame.width,
    pageHeight: frame.height,
    paths: [leaf],
    curvePaths: [circularArc(0, Math.PI / 2, options.pieces)],
    curvePathsTruncated: false,
    skippedCurves: 1,
    skippedCurveBounds: [
      { operationIndex: 10, bounds: { left: 400, top: 400, right: 500, bottom: 500 } },
    ],
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  const input = { native, work, lineworkSource: structuredClone(frame) }
  transformSource(input, (point) => ({
    x: point.x / (frame.width / 1000),
    y: point.y / (frame.height / 1000),
  }))
  return input
}

function transformSource(input: Input, transform: (point: PagePoint) => PagePoint) {
  for (const path of input.work.paths) path.points = path.points.map(transform)
  for (const path of input.work.curvePaths ?? []) {
    path.start = transform(path.start)
    path.segments = path.segments.map((segment) => {
      if (segment.kind === 'cubic')
        return {
          ...segment,
          control1: transform(segment.control1),
          control2: transform(segment.control2),
          end: transform(segment.end),
        }
      if (segment.kind === 'quadratic')
        return { ...segment, control: transform(segment.control), end: transform(segment.end) }
      return { ...segment, end: transform(segment.end) }
    })
  }
  refreshCurveBounds(input)
}

function refreshCurveBounds(input: Input) {
  input.work.skippedCurveBounds = (input.work.curvePaths ?? []).map((path) => {
    const points = [
      path.start,
      ...path.segments.flatMap((segment) => {
        if (segment.kind === 'cubic') return [segment.control1, segment.control2, segment.end]
        if (segment.kind === 'quadratic') return [segment.control, segment.end]
        return [segment.end]
      }),
    ]
    return {
      operationIndex: path.operationIndex,
      bounds: {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      },
    }
  })
}

function arcOf(input: Input) {
  const arc = input.work.curvePaths?.[0]
  if (!arc) throw new Error('Missing source arc')
  return arc
}

function leafOf(input: Input) {
  const leaf = input.work.paths[0]
  if (!leaf) throw new Error('Missing source leaf')
  return leaf
}

function expectNoCandidate(input: Input, reason?: string) {
  const result = nativeDoorSymbolCandidates(input)
  expect(result.candidates).toEqual([])
  expect(result.completeOpeningInventory).toBe(false)
  expect(result.closesFloorBoundary).toBe(false)
  if (reason) expect(result.rejected[0]?.reason).toBe(reason)
  return result
}

describe('native door-swing symbol candidates, not floor or passage authority', () => {
  it.each([1, 2])('recognizes a source quarter swing made of %i cubic segments', (pieces) => {
    const input = fixture({ pieces })
    const before = structuredClone(input)
    const result = nativeDoorSymbolCandidates(input)
    expect(result).toMatchObject({
      status: 'draft',
      basis: 'native-door-swing-and-leaf-fit',
      source: input.native.source,
      originalPdfSha256: input.native.originalPdfSha256,
      refusalReason: null,
      completeOpeningInventory: false,
      closesFloorBoundary: false,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      arc: arcOf(input),
      leaf: {
        operationIndex: 20,
        subpathIndex: 0,
        segmentIndex: 0,
        start: CENTER,
        end: { x: 500, y: 400 },
      },
      hinge: CENTER,
      closedTip: { x: 400, y: 500 },
      endpointResidualPixels: 0,
      attachment: 'symbol-fit-only',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
    expect(input).toEqual(before)
  })

  it.each([
    [2000, 1000],
    [1000, 2000],
    [1414, 2000],
  ])('corrects source page normalization using the %i × %i raster frame', (width, height) => {
    const input = fixture({ width, height, pieces: 2 })
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.arc).toEqual(arcOf(input))
    expect(result.candidates[0]?.shapeResidualRatio).toBeLessThan(1e-12)
  })

  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])(
    'recognizes a rotated source swing at %s radians without changing its source',
    (angle) => {
      const input = fixture({ pieces: 2 })
      transformSource(input, (point) => ({
        x:
          CENTER.x +
          Math.cos(angle) * (point.x - CENTER.x) -
          Math.sin(angle) * (point.y - CENTER.y),
        y:
          CENTER.y +
          Math.sin(angle) * (point.x - CENTER.x) +
          Math.cos(angle) * (point.y - CENTER.y),
      }))
      expect(nativeDoorSymbolCandidates(input).candidates).toHaveLength(1)
    },
  )

  it.each(['horizontal', 'vertical'] as const)('recognizes a %s reflection', (axis) => {
    const input = fixture()
    transformSource(input, (point) => ({
      x: axis === 'horizontal' ? CENTER.x * 2 - point.x : point.x,
      y: axis === 'vertical' ? CENTER.y * 2 - point.y : point.y,
    }))
    expect(nativeDoorSymbolCandidates(input).candidates).toHaveLength(1)
  })

  it('accepts reversed source leaf endpoint order', () => {
    const input = fixture()
    leafOf(input).points.reverse()
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.hinge).toEqual(CENTER)
    expect(result.candidates[0]?.leaf.start).toEqual({ x: 500, y: 400 })
  })

  it('recognizes correctly reversed cubic command order', () => {
    const input = fixture()
    input.work.curvePaths = [circularArc(Math.PI / 2, 0, 2)]
    refreshCurveBounds(input)
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.arc).toEqual(arcOf(input))
    expect(result.candidates[0]?.closedTip).toEqual(arcOf(input).start)
  })

  it('recognizes an independently painted thin source leaf rectangle', () => {
    const input = fixture()
    const leaf = leafOf(input)
    leaf.closed = true
    leaf.points = [
      { x: 400, y: 400 },
      { x: 500, y: 400 },
      { x: 500, y: 402 },
      { x: 400, y: 402 },
      { x: 400, y: 400 },
    ]
    const before = structuredClone(input)
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.leaf).toMatchObject({
      segmentIndex: 0,
      start: leaf.points[0],
      end: leaf.points[1],
    })
    expect(input).toEqual(before)
  })

  it.each(['thick', 'skewed', 'bow-tie', 'collapsed'])(
    'does not treat a %s quadrilateral as a source leaf rectangle',
    (change) => {
      const input = fixture()
      const leaf = leafOf(input)
      leaf.closed = true
      leaf.points = [
        { x: 400, y: 400 },
        { x: 500, y: 400 },
        { x: 500, y: 402 },
        { x: 400, y: 402 },
      ]
      if (change === 'thick') {
        leaf.points[2] = { x: 500, y: 410 }
        leaf.points[3] = { x: 400, y: 410 }
      }
      if (change === 'skewed') leaf.points[3] = { x: 400, y: 404 }
      if (change === 'bow-tie') {
        leaf.points[1] = { x: 500, y: 400.2 }
        leaf.points[2] = { x: 500, y: 400 }
        leaf.points[3] = { x: 400, y: 400.2 }
      }
      if (change === 'collapsed') {
        leaf.points[2] = { x: 500, y: 400 }
        leaf.points[3] = { x: 400, y: 400 }
      }
      expectNoCandidate(input)
    },
  )

  it('retains the unsnapped endpoints of a tiny source symbol-fit residual', () => {
    const input = fixture({ width: 2000, height: 1000 })
    const tip = leafOf(input).points[1]
    if (!tip) throw new Error('Missing source leaf tip')
    tip.x += 0.04
    const before = structuredClone(input)
    const result = nativeDoorSymbolCandidates(input)
    const candidate = result.candidates[0]
    expect(candidate).toBeDefined()
    expect(candidate?.endpointResidualPixels).toBeCloseTo(0.08)
    expect(candidate?.arc.start).not.toEqual(candidate?.leaf.end)
    expect(candidate?.leaf.end).toEqual(tip)
    expect(candidate).toMatchObject({
      attachment: 'symbol-fit-only',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
    expect(input).toEqual(before)
  })

  it('rejects a leaf beyond the declared endpoint-fit pixel limit', () => {
    const input = fixture({ width: 2000, height: 1000 })
    const tip = leafOf(input).points[1]
    if (!tip) throw new Error('Missing source leaf tip')
    tip.x += 0.051
    expectNoCandidate(input, 'no-quarter-swing-leaf-fit')
  })

  it('does not select an unrelated leaf by proximity', () => {
    const input = fixture()
    leafOf(input).points = [
      { x: 600, y: 600 },
      { x: 700, y: 600 },
    ]
    expectNoCandidate(input, 'no-quarter-swing-leaf-fit')
  })

  it.each(['full-open-circle', 'closed-quarter', 'half-circle'])(
    'does not turn a %s into a quarter-swing symbol',
    (change) => {
      const input = fixture()
      if (change === 'full-open-circle') input.work.curvePaths = [circularArc(0, Math.PI * 2, 4)]
      if (change === 'closed-quarter') arcOf(input).closed = true
      if (change === 'half-circle') input.work.curvePaths = [circularArc(0, Math.PI, 2)]
      expectNoCandidate(input)
    },
  )

  it('rejects an actual ellipse instead of trusting its page-space circular appearance', () => {
    const input = fixture({ width: 2000, height: 1000 })
    transformSource(input, (point) => ({ x: point.x * 2, y: point.y }))
    expectNoCandidate(input, 'no-quarter-swing-leaf-fit')
  })

  it('rejects quadratic curves without replacing them with a cubic approximation', () => {
    const input = fixture()
    arcOf(input).segments = [
      { kind: 'quadratic', control: { x: 500, y: 500 }, end: { x: 400, y: 500 } },
    ]
    expectNoCandidate(input, 'unsupported-swing-path')
  })

  it('rejects a cubic chain that reverses direction', () => {
    const input = fixture()
    const forward = circularArc(0, Math.PI / 4)
    const backward = circularArc(Math.PI / 4, 0)
    const onward = circularArc(0, Math.PI / 2)
    arcOf(input).segments = [...forward.segments, ...backward.segments, ...onward.segments]
    expectNoCandidate(input, 'no-quarter-swing-leaf-fit')
  })

  it('rejects a compound source curve operation even when the visible arc fits', () => {
    const input = fixture()
    arcOf(input).operationSubpathCount = 2
    expectNoCandidate(input, 'unsupported-swing-path')
  })

  it('rejects a source curve sharing its operation with a separate straight subpath', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 10,
      subpathIndex: 1,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 100, y: 100 },
        { x: 120, y: 100 },
      ],
    })
    expectNoCandidate(input, 'unsupported-swing-path')
  })

  it('rejects a compound leaf operation', () => {
    const input = fixture()
    input.work.paths.push({
      ...structuredClone(leafOf(input)),
      subpathIndex: 1,
      points: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
      ],
    })
    expectNoCandidate(input, 'no-quarter-swing-leaf-fit')
  })

  it('refuses competing source hinges instead of choosing the nearest leaf', () => {
    const input = fixture()
    input.work.paths.push({
      ...structuredClone(leafOf(input)),
      operationIndex: 21,
      points: [
        { x: 400.02, y: 400 },
        { x: 500, y: 400 },
      ],
    })
    expectNoCandidate(input, 'ambiguous-leaf-attachment')
  })

  it('collapses only exact repaint aliases, preserving a real source reference', () => {
    const input = fixture()
    input.work.paths.push({ ...structuredClone(leafOf(input)), operationIndex: 21 })
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.leaf.operationIndex).toBe(20)
  })

  it.each(['arc', 'leaf'] as const)(
    'rejects fill-painted %s geometry as a swing symbol',
    (role) => {
      const input = fixture()
      if (role === 'arc') arcOf(input).paint = 'fill'
      else leafOf(input).paint = 'fill'
      expectNoCandidate(input)
    },
  )

  it.each(['arc', 'leaf'] as const)('rejects a clipped %s operation', (role) => {
    const input = fixture()
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      {
        operationIndex: role === 'arc' ? 10 : 20,
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      },
    ]
    expectNoCandidate(input)
  })

  it('does not require complete native text to inspect independently sourced geometry', () => {
    const input = fixture()
    input.native.complete = false
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      attachment: 'symbol-fit-only',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
    expect(result.completeOpeningInventory).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
  })

  it.each(['paths', 'curve-commands', 'curve-bounds', 'unsupported-context'])(
    'refuses an incomplete %s layer',
    (change) => {
      const input = fixture()
      if (change === 'paths') input.work.truncated = true
      if (change === 'curve-commands') input.work.curvePathsTruncated = true
      if (change === 'curve-bounds') input.work.skippedCurveBoundsTruncated = true
      if (change === 'unsupported-context') input.work.unsupportedContexts = 1
      expect(expectNoCandidate(input)).toMatchObject({
        status: 'unresolved',
        refusalReason: 'incomplete-native-layer',
      })
    },
  )

  it('refuses a saved source whose curve commands were not retained', () => {
    const input = fixture()
    delete input.work.curvePaths
    expect(expectNoCandidate(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'curve-commands-unavailable',
    })
  })

  it('does not silently accept missing curve operation metadata', () => {
    const input = fixture()
    const arc = arcOf(input)
    delete (arc as Partial<PdfCurvePath>).operationSubpathCount
    expectNoCandidate(input, 'unsupported-swing-path')
  })

  it('requires matching retained omission metadata for the source curve operation', () => {
    const input = fixture()
    input.work.skippedCurveBounds = [
      { operationIndex: 99, bounds: { left: 400, top: 400, right: 500, bottom: 500 } },
    ]
    expectNoCandidate(input, 'unsupported-swing-path')
  })

  it.each(['left', 'top', 'right', 'bottom'] as const)(
    'rejects retained cubic commands with a stale %s bound',
    (side) => {
      const input = fixture()
      const bounds = input.work.skippedCurveBounds?.[0]?.bounds
      if (!bounds) throw new Error('Missing curve omission bounds')
      bounds[side] += 0.001
      expectNoCandidate(input, 'stale-curve-command-bounds')
    },
  )

  it.each(['nan', 'infinity', 'reversed-horizontal', 'reversed-vertical'])(
    'rejects invalid omission bounds: %s',
    (change) => {
      const input = fixture()
      const bounds = input.work.skippedCurveBounds?.[0]?.bounds
      if (!bounds) throw new Error('Missing curve omission bounds')
      if (change === 'nan') bounds.left = Number.NaN
      if (change === 'infinity') bounds.bottom = Number.POSITIVE_INFINITY
      if (change === 'reversed-horizontal') bounds.left = bounds.right + 1
      if (change === 'reversed-vertical') bounds.top = bounds.bottom + 1
      expect(expectNoCandidate(input)).toMatchObject({
        status: 'unresolved',
        refusalReason: 'invalid-omission-bounds',
      })
    },
  )

  it.each(['duplicate-ref', 'negative-ref', 'non-finite-point', 'out-of-page-point'])(
    'rejects invalid native provenance: %s',
    (change) => {
      const input = fixture()
      if (change === 'duplicate-ref') input.work.paths.push(structuredClone(leafOf(input)))
      if (change === 'negative-ref') arcOf(input).operationIndex = -1
      if (change === 'non-finite-point') arcOf(input).start.x = Number.NaN
      if (change === 'out-of-page-point') arcOf(input).start.x = 1000.01
      expect(expectNoCandidate(input)).toMatchObject({
        status: 'unresolved',
        refusalReason: 'invalid-native-provenance',
      })
    },
  )

  it.each(['sha256', 'page', 'width', 'height'] as const)(
    'rejects source frame %s mismatches before recognition',
    (field) => {
      const input = fixture()
      if (field === 'sha256') input.lineworkSource.sha256 = 'c'.repeat(64)
      else input.lineworkSource[field]++
      expect(() => nativeDoorSymbolCandidates(input)).toThrow('source frames differ')
    },
  )

  it('returns detached arc and leaf evidence, preserving the exact native snapshots', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeDoorSymbolCandidates(input)
    const candidate = result.candidates[0]
    if (!candidate) throw new Error('Missing candidate evidence')
    const segment = candidate.arc.segments[0]
    if (!segment) throw new Error('Missing source cubic evidence')
    candidate.arc.start.x++
    segment.control1.x++
    candidate.leaf.start.x++
    candidate.hinge.y++
    expect(input).toEqual(before)
  })
})
