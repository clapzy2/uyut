import { describe, expect, it } from 'vitest'
import { nativeNumberCircleCandidates } from './plan-native-number-circles'
import type { Bounds, PagePoint, PdfCurvePath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeNumberCircleCandidates>[0]

function circle(
  options: {
    operation?: number
    center?: PagePoint
    radius?: number
    direction?: number
    start?: number
  } = {},
): PdfCurvePath {
  const center = options.center ?? { x: 400, y: 400 }
  const radius = options.radius ?? 15
  const cardinal = [
    { x: radius, y: 0 },
    { x: 0, y: radius },
    { x: -radius, y: 0 },
    { x: 0, y: -radius },
  ]
  const direction = options.direction ?? 1
  const offset = options.start ?? 0
  const points = Array.from({ length: 5 }, (_, index) => {
    const vector = cardinal[(offset + direction * index + 8) % 4] as PagePoint
    return { x: center.x + vector.x, y: center.y + vector.y }
  })
  const k = direction * (4 / 3) * Math.tan(Math.PI / 8)
  return {
    operationIndex: options.operation ?? 10,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: true,
    start: points[0] as PagePoint,
    segments: points.slice(1).map((end, index) => {
      const start = points[index] as PagePoint
      return {
        kind: 'cubic',
        control1: { x: start.x - k * (start.y - center.y), y: start.y + k * (start.x - center.x) },
        control2: { x: end.x + k * (end.y - center.y), y: end.y - k * (end.x - center.x) },
        end,
      }
    }),
  }
}

function refresh(input: Input) {
  input.work.skippedCurves = input.work.curvePaths?.length ?? 0
  input.work.skippedCurveBounds = (input.work.curvePaths ?? []).map((path) => {
    const points = [
      path.start,
      ...path.segments.flatMap((part) =>
        part.kind === 'cubic'
          ? [part.control1, part.control2, part.end]
          : part.kind === 'quadratic'
            ? [part.control, part.end]
            : [part.end],
      ),
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

function fixture(options: Parameters<typeof circle>[0] = {}): Input {
  const source = { sha256: 'a'.repeat(64), page: 6, width: 1000, height: 1000 }
  const point = options.center ?? { x: 400, y: 400 }
  const input: Input = {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-7',
          nativeIndex: 7,
          name: '2',
          rotation: 0,
          pagePoint: { ...point },
          point: { ...point },
        },
      ],
    },
    lineworkSource: { ...source },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [],
      curvePaths: [circle(options)],
      curvePathsTruncated: false,
      skippedCurves: 0,
      skippedCurveBounds: [],
      clippedPaths: 0,
      clippedPathBounds: [],
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
  refresh(input)
  return input
}

function curveOf(input: Input) {
  const curve = input.work.curvePaths?.[0]
  if (!curve) throw new Error('Missing fixture curve')
  return curve
}

function curvesOf(input: Input) {
  const curves = input.work.curvePaths
  if (!curves) throw new Error('Missing fixture curves')
  return curves
}

function labelOf(input: Input) {
  const label = input.native.labels[0]
  if (!label) throw new Error('Missing fixture label')
  return label
}

function segmentOf(input: Input, index: number) {
  const segment = curveOf(input).segments[index]
  if (!segment) throw new Error('Missing fixture segment')
  return segment
}

function boundsOf(input: Input): Bounds {
  const bounds = input.work.skippedCurveBounds?.[0]?.bounds
  if (!bounds) throw new Error('Missing fixture omission bounds')
  return bounds
}

function moveLabel(input: Input, point: PagePoint) {
  const label = labelOf(input)
  const scale = input.native.pageNormalizedScale
  if (!scale) throw new Error('Missing fixture raster mapping')
  label.pagePoint = { ...point }
  label.point = { x: point.x * scale.x, y: point.y * scale.y }
}

function expectNoCue(input: Input, reason?: string) {
  const before = structuredClone(input)
  const result = nativeNumberCircleCandidates(input)
  expect(result.cues).toEqual([])
  expect(result.roomOwnershipConfirmed).toBe(false)
  expect(result.closesFloorBoundary).toBe(false)
  expect(result.readOnly).toBe(true)
  if (reason) expect(result.refusalReason).toBe(reason)
  expect(input).toEqual(before)
  return result
}

describe('native number-circle source cues, not room ownership', () => {
  it('keeps a canonical decimal number as one source caption, not room 3 plus label 1', () => {
    const input = fixture()
    labelOf(input).name = '3.1'
    const before = structuredClone(input)
    const result = nativeNumberCircleCandidates(input)
    expect(result.cues.map((cue) => cue.sourceNumber)).toEqual([3.1])
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
  })
  it.each(['3.10', '03.1', '3,1', '3.0001', '3.1e0'])(
    'does not normalize ambiguous circle caption %s',
    (name) => {
      const input = fixture()
      labelOf(input).name = name
      expect(nativeNumberCircleCandidates(input).cues).toEqual([])
    },
  )
  it('does not join separate numeric text observations inside a circle', () => {
    const input = fixture()
    labelOf(input).name = '3'
    input.native.labels.push({
      ...structuredClone(labelOf(input)),
      id: 'native-text-8',
      nativeIndex: 8,
      name: '1',
    })
    expect(nativeNumberCircleCandidates(input).cues).toEqual([])
  })
  it.each([1, -1])('keeps source commands for direction %i', (direction) => {
    const input = fixture({ direction })
    const before = structuredClone(input)
    const result = nativeNumberCircleCandidates(input)
    expect(result.status).toBe('draft')
    expect(result.refusalReason).toBeNull()
    expect(result.cues).toEqual([
      {
        labelId: 'native-text-7',
        sourceNumber: 2,
        pagePoint: { x: 400, y: 400 },
        bounds: { left: 385, top: 385, right: 415, bottom: 415 },
        curve: curveOf(input),
      },
    ])
    expect(input).toEqual(before)
    const cue = result.cues[0]
    if (!cue) throw new Error('Missing recognized cue')
    cue.curve.start.x = 999
    expect(input).toEqual(before)
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
  })

  it.each([0, 1, 2, 3])('accepts a cardinal start %i without reordering', (start) => {
    expect(nativeNumberCircleCandidates(fixture({ start })).cues).toHaveLength(1)
  })

  it('uses raster aspect rather than normalized-page radii', () => {
    const input = fixture()
    input.native.source.width = 1414
    input.native.source.height = 2000
    const xScale = input.native.source.width / 1000
    input.native.pageNormalizedScale = { x: xScale, y: 2 }
    input.lineworkSource = { ...input.native.source }
    const transform = (p: PagePoint) => ({ x: p.x / xScale, y: p.y / 2 })
    const curve = curveOf(input)
    curve.start = transform(curve.start)
    curve.segments = curve.segments.map((part) => {
      if (part.kind !== 'cubic') throw new Error('Not a cubic fixture')
      return {
        ...part,
        control1: transform(part.control1),
        control2: transform(part.control2),
        end: transform(part.end),
      }
    })
    moveLabel(input, transform({ x: 400, y: 400 }))
    refresh(input)
    expect(nativeNumberCircleCandidates(input).cues).toHaveLength(1)
  })

  it.each([2.5, 25])('accepts supported raster radius %f', (radius) => {
    expect(nativeNumberCircleCandidates(fixture({ radius })).cues).toHaveLength(1)
  })
  it.each([2.49, 25.01])('does not accept raster radius %f', (radius) => {
    expectNoCue(fixture({ radius }))
  })
  it.each(['0', '00', '01', '-1', '2.0', '2,0', '1 2', '10000', 'Кухня', '№2'])(
    'does not treat %s as a number cue',
    (name) => {
      const input = fixture()
      labelOf(input).name = name
      expectNoCue(input)
    },
  )
  it.each(['1', '8', '9999'])('preserves numeric value %s without table meanings', (name) => {
    const input = fixture()
    labelOf(input).name = name
    expect(nativeNumberCircleCandidates(input).cues[0]?.sourceNumber).toBe(Number(name))
  })
  it.each([0, 90, -90])('requires upright label, supplied %i', (rotation) => {
    const input = fixture()
    labelOf(input).rotation = rotation
    expect(nativeNumberCircleCandidates(input).cues).toHaveLength(rotation === 0 ? 1 : 0)
  })
  it('requires source label origin strictly inside the circle, not its bounding rectangle', () => {
    const input = fixture()
    moveLabel(input, { x: 412, y: 412 })
    expectNoCue(input)
  })
  it.each([
    { x: 415, y: 400 },
    { x: 416, y: 400 },
  ])('does not choose nearby/boundary label', (point) => {
    const input = fixture()
    moveLabel(input, point)
    expectNoCue(input)
  })
  it.each(['2', '3', 'Ванная'])('holds competing caption %s within one circle', (name) => {
    const input = fixture()
    input.native.labels.push({
      ...labelOf(input),
      id: 'native-text-8',
      nativeIndex: 8,
      name,
    })
    expectNoCue(input)
  })
  it('holds one caption enclosed by two independently painted circles', () => {
    const input = fixture()
    curvesOf(input).push(circle({ operation: 11, radius: 16 }))
    refresh(input)
    expectNoCue(input)
  })
  it('does not choose between exact repeated paint aliases', () => {
    const input = fixture()
    curvesOf(input).push(circle({ operation: 11 }))
    refresh(input)
    expectNoCue(input)
  })
  it('holds an otherwise valid cue when another circle encloses it and a second caption', () => {
    const input = fixture({ radius: 5 })
    curvesOf(input).push(circle({ operation: 11, radius: 16 }))
    input.native.labels.push({
      ...labelOf(input),
      id: 'native-text-8',
      nativeIndex: 8,
      name: '3',
      pagePoint: { x: 410, y: 400 },
      point: { x: 410, y: 400 },
    })
    refresh(input)
    expectNoCue(input)
  })
  it('keeps independent circles with repeated numbers as cues, not distinct-room evidence', () => {
    const input = fixture()
    curvesOf(input).push(circle({ operation: 11, center: { x: 500, y: 500 } }))
    input.native.labels.push({
      ...labelOf(input),
      id: 'native-text-8',
      nativeIndex: 8,
      pagePoint: { x: 500, y: 500 },
      point: { x: 500, y: 500 },
    })
    refresh(input)
    const result = nativeNumberCircleCandidates(input)
    expect(result.cues).toHaveLength(2)
    expect(result.cues.map((cue) => cue.sourceNumber)).toEqual([2, 2])
    expect(result.roomOwnershipConfirmed).toBe(false)
  })
  it.each(['fill', 'fill-stroke'] as const)(
    'does not accept %s circles as this profile',
    (paint) => {
      const input = fixture()
      curveOf(input).paint = paint
      expectNoCue(input)
    },
  )
  it('requires exact source closure', () => {
    const input = fixture()
    segmentOf(input, 3).end.x += 0.001
    refresh(input)
    expectNoCue(input)
  })
  it('does not accept a merely flagged closed path', () => {
    const input = fixture()
    curveOf(input).closed = false
    expectNoCue(input)
  })
  it('requires four cubic quarters', () => {
    const input = fixture()
    curveOf(input).segments[0] = { kind: 'line', end: segmentOf(input, 0).end }
    refresh(input)
    expectNoCue(input)
  })
  it('rejects a changed curvature despite cardinal endpoints', () => {
    const input = fixture()
    const part = segmentOf(input, 0)
    if (part.kind !== 'cubic') throw new Error('Not cubic')
    part.control1.x += 1
    refresh(input)
    expectNoCue(input)
  })
  it('rejects an ellipse drawn on a square raster', () => {
    const input = fixture()
    const curve = curveOf(input)
    const stretch = (p: PagePoint) => ({ x: p.x, y: 400 + (p.y - 400) * 1.1 })
    curve.start = stretch(curve.start)
    curve.segments = curve.segments.map((part) => {
      if (part.kind !== 'cubic') throw new Error('Not cubic')
      return {
        ...part,
        control1: stretch(part.control1),
        control2: stretch(part.control2),
        end: stretch(part.end),
      }
    })
    refresh(input)
    expectNoCue(input)
  })
  it('requires ordered quarters, not backtracking', () => {
    const input = fixture()
    const curve = curveOf(input)
    curve.segments = [
      segmentOf(input, 0),
      segmentOf(input, 3),
      segmentOf(input, 2),
      segmentOf(input, 1),
    ]
    refresh(input)
    expectNoCue(input)
  })

  it.each(['truncated', 'unsupportedPaths', 'unsupportedContexts', 'curvePathsTruncated'] as const)(
    'fails atomically for %s',
    (key) => {
      const input = fixture()
      if (key === 'unsupportedPaths' || key === 'unsupportedContexts') input.work[key] = 1
      else input.work[key] = true
      expectNoCue(input, 'incomplete-native-layer')
    },
  )
  it('holds unavailable curve commands rather than reconstructing bounds', () => {
    const input = fixture()
    delete input.work.curvePaths
    expectNoCue(input, 'curve-commands-unavailable')
  })
  it('requires native text completeness', () => {
    const input = fixture()
    input.native.complete = false
    expectNoCue(input, 'incomplete-native-text')
  })
  it.each(['id', 'nativeIndex', 'pagePoint', 'point', 'rotation', 'name'] as const)(
    'requires label %s provenance',
    (key) => {
      const input = fixture()
      const label = labelOf(input)
      if (key === 'id') label.id = 'invented'
      if (key === 'nativeIndex') delete label.nativeIndex
      if (key === 'pagePoint') delete label.pagePoint
      if (key === 'point') label.point.x += 1
      if (key === 'rotation') label.rotation = Number.NaN
      if (key === 'name') label.name = ' 2 '
      expectNoCue(input, 'invalid-native-text-provenance')
    },
  )
  it('rejects duplicate source labels', () => {
    const input = fixture()
    input.native.labels.push(structuredClone(labelOf(input)))
    expectNoCue(input, 'invalid-native-text-provenance')
  })
  it.each(['sha256', 'page', 'width'] as const)('requires matching raster %s', (key) => {
    const input = fixture()
    if (key === 'sha256') input.lineworkSource.sha256 = 'c'.repeat(64)
    else input.lineworkSource[key]++
    expectNoCue(input, 'source-frame-unavailable')
  })
  it('requires original PDF fingerprint', () => {
    const input = fixture()
    delete input.native.originalPdfSha256
    expectNoCue(input, 'source-frame-unavailable')
  })
  it('rejects duplicate native curve references', () => {
    const input = fixture()
    curvesOf(input).push(structuredClone(curveOf(input)))
    refresh(input)
    expectNoCue(input, 'invalid-native-provenance')
  })
  it('rejects conflicting straight source reference', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 10,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    })
    expectNoCue(input, 'invalid-native-provenance')
  })
  it('does not accept compound paths as standalone circle evidence', () => {
    const input = fixture()
    curveOf(input).operationSubpathCount = 2
    expectNoCue(input)
  })
  it('rejects non-finite curve commands', () => {
    const input = fixture()
    curveOf(input).start.x = Number.NaN
    expectNoCue(input, 'invalid-native-provenance')
  })
  it.each(['left', 'top', 'right', 'bottom'] as const)(
    'requires fresh omitted %s bounds',
    (key) => {
      const input = fixture()
      boundsOf(input)[key] += 0.001
      expectNoCue(input)
    },
  )
  it('does not accept a source operation also reported clipped', () => {
    const input = fixture()
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [{ operationIndex: 10, bounds: { ...boundsOf(input) } }]
    expectNoCue(input)
  })
  it('rejects incomplete curve omission accounting', () => {
    const input = fixture()
    input.work.skippedCurves = 2
    expectNoCue(input, 'invalid-omission-provenance')
  })
  it('returns an empty supported result when there are no circles', () => {
    const input = fixture()
    input.work.curvePaths = []
    refresh(input)
    expect(expectNoCue(input).status).toBe('draft')
  })
  it.each([0, 1])(
    'does not infer a unique caption from %s retained competing curves',
    (retained) => {
      const input = fixture()
      curvesOf(input).push(circle({ operation: 11 }))
      refresh(input)
      expect(expectNoCue(input).status).toBe('draft')
      input.work.curvePaths = curvesOf(input).slice(0, retained)
      expectNoCue(input, 'curve-commands-incomplete')
    },
  )
  it('fails atomically at the cue limit', () => {
    const input = fixture()
    input.work.curvePaths = []
    input.native.labels = []
    for (let index = 0; index < 101; index++) {
      const center = { x: 50 + (index % 15) * 50, y: 50 + Math.floor(index / 15) * 50 }
      input.work.curvePaths.push(circle({ operation: 10 + index, center }))
      input.native.labels.push({
        id: `native-text-${index}`,
        nativeIndex: index,
        name: `${index + 1}`,
        rotation: 0,
        pagePoint: { ...center },
        point: { ...center },
      })
    }
    refresh(input)
    expectNoCue(input, 'number-circle-candidate-limit')
  })
  it('fails atomically before an oversized circle-label search', () => {
    const input = fixture()
    input.work.curvePaths = Array.from({ length: 201 }, (_, index) =>
      circle({ operation: index + 10 }),
    )
    input.native.labels = Array.from({ length: 1000 }, (_, index) => ({
      id: `native-text-${index}`,
      nativeIndex: index,
      name: `${index + 1}`,
      rotation: 0,
      pagePoint: { x: 800, y: 800 },
      point: { x: 800, y: 800 },
    }))
    refresh(input)
    expectNoCue(input, 'number-circle-work-limit')
  })
})
