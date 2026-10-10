import { describe, expect, it } from 'vitest'
import { nativeDoorSymbolCandidates } from './plan-native-door-symbols'
import type { PagePoint, PdfCurvePath, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeDoorSymbolCandidates>[0]
type Cubic = Extract<PdfCurvePath['segments'][number], { kind: 'cubic' }>

const CENTER = { x: 400, y: 400 }
const RADIUS = 100

function rectangle(
  operationIndex: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
      { x: left, y: top },
    ],
  }
}

function line(operationIndex: number, start: PagePoint, end: PagePoint): PdfVectorPath {
  return { operationIndex, subpathIndex: 0, paint: 'stroke', closed: false, points: [start, end] }
}

function arc(angles: number[] = [0, 90]): PdfCurvePath {
  const point = (degrees: number): PagePoint => {
    const radians = (degrees * Math.PI) / 180
    return {
      x: CENTER.x + RADIUS * Math.cos(radians),
      y: CENTER.y + RADIUS * Math.sin(radians),
    }
  }
  const segments: Cubic[] = []
  for (let index = 1; index < angles.length; index++) {
    const from = angles[index - 1] as number
    const to = angles[index] as number
    const start = point(from)
    const end = point(to)
    const k = (4 / 3) * Math.tan(((to - from) * Math.PI) / 720)
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
    closed: false,
    start: point(angles[0] as number),
    segments,
  }
}

function refreshBounds(input: Input) {
  input.work.skippedCurveBounds = (input.work.curvePaths ?? []).map((path) => {
    const points = [
      path.start,
      ...path.segments.flatMap((segment) =>
        segment.kind === 'cubic'
          ? [segment.control1, segment.control2, segment.end]
          : segment.kind === 'quadratic'
            ? [segment.control, segment.end]
            : [segment.end],
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

function fixture(angles: number[] = [0, 90]): Input {
  const source = { sha256: 'a'.repeat(64), page: 6, width: 1000, height: 1000 }
  const input: Input = {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      labels: [],
      pageNormalizedScale: { x: 1, y: 1 },
    },
    lineworkSource: structuredClone(source),
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [
        rectangle(20, 404, 400, 496, 404),
        rectangle(21, 400, 400, 404, 404),
        rectangle(22, 496, 400, 500, 404),
      ],
      curvePaths: [arc(angles)],
      curvePathsTruncated: false,
      skippedCurves: 1,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
  refreshBounds(input)
  return input
}

function transform(input: Input, fn: (point: PagePoint) => PagePoint) {
  for (const path of input.work.paths) path.points = path.points.map(fn)
  for (const path of input.work.curvePaths ?? []) {
    path.start = fn(path.start)
    path.segments = path.segments.map((segment) => {
      if (segment.kind === 'cubic')
        return {
          ...segment,
          control1: fn(segment.control1),
          control2: fn(segment.control2),
          end: fn(segment.end),
        }
      if (segment.kind === 'quadratic')
        return { ...segment, control: fn(segment.control), end: fn(segment.end) }
      return { ...segment, end: fn(segment.end) }
    })
  }
  refreshBounds(input)
}

function sourceArc(input: Input) {
  const path = input.work.curvePaths?.[0]
  if (!path) throw new Error('Missing source arc')
  return path
}

function expectNoDoor(input: Input) {
  const result = nativeDoorSymbolCandidates(input)
  expect(result.candidates).toEqual([])
  expect(result.completeOpeningInventory).toBe(false)
  expect(result.closesFloorBoundary).toBe(false)
  return result
}

describe('compound native door leaf evidence', () => {
  it('keeps the three real side fragments and the body reference, never a fused source line', () => {
    const input = fixture()
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    expect(candidate).toMatchObject({
      leafProfile: 'capped-panel',
      leaf: {
        operationIndex: 20,
        subpathIndex: 0,
        segmentIndex: 0,
        start: { x: 404, y: 400 },
        end: { x: 496, y: 400 },
      },
      hinge: CENTER,
      closedTip: { x: 400, y: 500 },
      swingAngleDegrees: 90,
      endpointResidualPixels: 0,
      attachment: 'symbol-fit-only',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
    expect(candidate?.leafParts?.map((part) => part.operationIndex)).toEqual([21, 20, 22])
    expect(candidate?.leafParts).toHaveLength(3)
    expect(candidate?.leafParts).not.toContainEqual(
      expect.objectContaining({ start: CENTER, end: { x: 500, y: 400 } }),
    )
    expect(result.completeOpeningInventory).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
  })

  it('recognizes the asymmetric two-piece 91.65-degree balcony-symbol class', () => {
    const input = fixture([0, 42, 91.65])
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.swingAngleDegrees).toBeCloseTo(91.65, 10)
    expect(result.candidates[0]?.shapeResidualRatio).toBeLessThan(1e-12)
    expect(result.candidates[0]?.arc).toEqual(sourceArc(input))
  })

  it('fits horizontal, vertical and reflected leaves in the actual raster aspect ratio', () => {
    for (const map of [
      (point: PagePoint) => point,
      (point: PagePoint) => ({ x: point.y, y: point.x }),
      (point: PagePoint) => ({ x: 800 - point.x, y: point.y }),
      (point: PagePoint) => ({ x: point.x, y: 800 - point.y }),
    ]) {
      const input = fixture([0, 42, 91.65])
      transform(input, map)
      input.native.source.width = 2000
      input.native.source.height = 1414
      input.lineworkSource = structuredClone(input.native.source)
      const heightScale = input.native.source.height / 1000
      input.native.pageNormalizedScale = { x: 2, y: heightScale }
      input.work.pageWidth = 2000
      input.work.pageHeight = 1414
      transform(input, (point) => ({ x: point.x / 2, y: point.y / heightScale }))
      const result = nativeDoorSymbolCandidates(input)
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]?.leafParts).toHaveLength(3)
      expect(result.candidates[0]?.swingAngleDegrees).toBeCloseTo(91.65, 10)
      expect(result.candidates[0]?.shapeResidualRatio).toBeLessThan(1e-12)
    }
  })

  it('recognizes a reversed source sweep and reports its positive magnitude', () => {
    const input = fixture([91.65, 42, 0])
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.swingAngleDegrees).toBeCloseTo(91.65, 10)
    expect(result.candidates[0]?.closedTip).toEqual(sourceArc(input).start)
  })

  it('reports a bounded arc-endpoint fit without moving the source cap corner', () => {
    const input = fixture()
    const sourceStart = sourceArc(input).start
    sourceStart.x += 0.08
    refreshBounds(input)
    const before = structuredClone(input)
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.endpointResidualPixels).toBeCloseTo(0.08, 10)
    expect(result.candidates[0]?.leafParts?.[2]?.end).toEqual({ x: 500, y: 400 })
    expect(result.candidates[0]?.arc.start).toEqual(sourceStart)
    expect(input).toEqual(before)
  })

  it('does not accept an arc endpoint beyond the existing 0.1-pixel fit', () => {
    const input = fixture()
    sourceArc(input).start.x += 0.101
    refreshBounds(input)
    expectNoDoor(input)
  })

  it('does not complete a leaf when either real endcap is missing', () => {
    for (const operationIndex of [21, 22]) {
      const input = fixture()
      input.work.paths = input.work.paths.filter((path) => path.operationIndex !== operationIndex)
      expectNoDoor(input)
    }
  })

  it.each([1e-9, -1e-9])('does not repair an endcap gap or overlap of %s', (offset) => {
    const input = fixture()
    input.work.paths[1] = rectangle(21, 400, 400, 404 + offset, 404)
    expectNoDoor(input)
  })

  it('refuses competing hinges instead of selecting the capped profile over a nearby single leaf', () => {
    const input = fixture()
    input.work.paths.push(line(40, { x: 400.02, y: 400 }, { x: 500, y: 400 }))
    expect(expectNoDoor(input).rejected).toContainEqual({
      operationIndex: 10,
      subpathIndex: 0,
      reason: 'ambiguous-leaf-attachment',
    })
  })

  it('ignores an unrelated nearby panel without changing the actual source attachment', () => {
    const input = fixture()
    input.work.paths.push(
      rectangle(30, 404, 412, 496, 416),
      rectangle(31, 400, 412, 404, 416),
      rectangle(32, 496, 412, 500, 416),
    )
    const result = nativeDoorSymbolCandidates(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.leafParts?.map((part) => part.operationIndex)).toEqual([
      21, 20, 22,
    ])
  })

  it('does not classify a centered glazing panel as a door leaf merely because an arc is nearby', () => {
    for (const competing of [false, true]) {
      const input = fixture()
      input.work.paths.push(line(40, { x: 404, y: 402 }, { x: 496, y: 402 }))
      if (competing) input.work.paths.push(line(41, { x: 404, y: 402.001 }, { x: 496, y: 402.001 }))
      const result = expectNoDoor(input)
      if (!competing)
        expect(result.compoundPanels.panels[0]?.glazingHint).toBe('independent-centered-line')
    }
  })

  it.each(['matched', 'ambiguous'] as const)(
    'does not reclassify a %s glazing body through the legacy thin-rectangle branch',
    (centerlineStatus) => {
      const input = fixture()
      transform(input, (point) => ({ x: point.x - 300, y: point.y - 300 }))
      input.work.paths = [
        rectangle(20, 100, 100, 200, 105),
        rectangle(21, 95, 100, 100, 105),
        rectangle(22, 200, 100, 205, 105),
        line(40, { x: 100, y: 102.5 }, { x: 200, y: 102.5 }),
      ]
      if (centerlineStatus === 'ambiguous')
        input.work.paths.push(line(41, { x: 100, y: 102.501 }, { x: 200, y: 102.501 }))
      // This real body edge exactly fits the quarter arc; the overall cap corner does not.
      expect(sourceArc(input).start).toEqual(input.work.paths[0]?.points[1])
      const before = structuredClone(input)
      const result = expectNoDoor(input)
      expect(result.compoundPanels.panels).toHaveLength(1)
      expect(result.compoundPanels.panels[0]).toMatchObject({
        body: input.work.paths[0],
        centerlineStatus,
      })
      expect(input).toEqual(before)
    },
  )

  it('does not reuse a clipped component or its valid-looking siblings as a whole source leaf', () => {
    for (const operationIndex of [10, 20, 21, 22]) {
      const input = fixture()
      input.work.clippedPaths = 1
      input.work.clippedPathBounds = [
        { operationIndex, bounds: { left: 800, top: 800, right: 810, bottom: 810 } },
      ]
      expectNoDoor(input)
    }
  })

  it('does not reuse an endcap from a compound painting operation', () => {
    const input = fixture()
    input.work.paths.push({ ...line(21, { x: 800, y: 800 }, { x: 810, y: 800 }), subpathIndex: 1 })
    expectNoDoor(input)
  })

  it('still requires the actual cubic control points to fit the circular source swing', () => {
    const input = fixture([0, 42, 91.65])
    const segment = sourceArc(input).segments[0]
    if (segment?.kind !== 'cubic') throw new Error('Missing source cubic')
    segment.control1.y += 2
    refreshBounds(input)
    expectNoDoor(input)
  })

  it('rejects compound sweeps outside the explicit 80-to-100-degree profile', () => {
    for (const sweep of [79.9, 100.1]) expectNoDoor(fixture([0, 40, sweep]))
  })

  it('includes both supported sweep boundaries without treating the candidate as a passage', () => {
    for (const sweep of [80, 100]) {
      const result = nativeDoorSymbolCandidates(fixture([0, 40, sweep]))
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]?.swingAngleDegrees).toBeCloseTo(sweep, 10)
      expect(result.candidates[0]?.physicalPassageAccepted).toBe(false)
    }
  })

  it('does not relax the old quarter-swing angle rule for a single-stroke leaf', () => {
    for (const [sweep, accepted] of [
      [89.8, true],
      [90.2, true],
      [91.65, false],
      [80, false],
    ] as const) {
      const input = fixture([0, 40, sweep])
      input.work.paths = [line(40, CENTER, { x: 500, y: 400 })]
      const result = nativeDoorSymbolCandidates(input)
      expect(result.candidates).toHaveLength(accepted ? 1 : 0)
      if (accepted) expect(result.candidates[0]?.leafProfile).toBe('single-stroke')
    }
  })

  it('returns detached curve, component edges and compound profile snapshots', () => {
    const input = fixture([0, 42, 91.65])
    const before = structuredClone(input)
    const result = nativeDoorSymbolCandidates(input)
    expect(input).toEqual(before)
    const candidate = result.candidates[0]
    const part = candidate?.leafParts?.[0]
    const panel = result.compoundPanels.panels[0]
    const bodyStart = panel?.body.points[0]
    if (!candidate || !part || !panel || !bodyStart)
      throw new Error('Missing detached compound evidence')
    candidate.arc.start.x++
    candidate.hinge.y++
    candidate.leaf.end.x++
    part.start.y++
    bodyStart.x++
    expect(input).toEqual(before)
  })

  it('withholds a budget-exhausted compound search without suppressing an independent single leaf', () => {
    const input = fixture()
    input.work.paths.push(line(40, CENTER, { x: 500, y: 400 }))
    for (let index = 0; index < 2996; index++)
      input.work.paths.push(rectangle(index + 100, 100, 100, 200, 104))
    const result = nativeDoorSymbolCandidates(input)
    expect(result.compoundPanels.refusalReason).toBe('panel-search-budget')
    expect(result.compoundPanels.panels).toEqual([])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      leafProfile: 'single-stroke',
      leaf: { operationIndex: 40 },
    })
    expect(result.completeOpeningInventory).toBe(false)
  })
})
