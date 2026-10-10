import { describe, expect, it } from 'vitest'
import { exactMonotoneCubicLoopLocation } from './plan-native-cubic-location'
import type { PagePoint, PdfCurvePath } from './plan-pdf-linework'

type Cubic = Extract<PdfCurvePath['segments'][number], { kind: 'cubic' }>

function fixture(radius = 27, handle = 9): PdfCurvePath {
  const center = { x: 400, y: 400 }
  const points = [
    { x: 400 + radius, y: 400 },
    { x: 400, y: 400 + radius },
    { x: 400 - radius, y: 400 },
    { x: 400, y: 400 - radius },
  ]
  return {
    operationIndex: 10,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: true,
    start: { ...(points[0] as PagePoint) },
    segments: points.map((start, index) => {
      const end = points[(index + 1) % 4] as PagePoint
      return {
        kind: 'cubic',
        control1: {
          x: start.x - ((start.y - center.y) * handle) / radius,
          y: start.y + ((start.x - center.x) * handle) / radius,
        },
        control2: {
          x: end.x + ((end.y - center.y) * handle) / radius,
          y: end.y - ((end.x - center.x) * handle) / radius,
        },
        end: { ...end },
      }
    }),
  }
}

function cubicOf(curve: PdfCurvePath, index = 0): Cubic {
  const segment = curve.segments[index]
  if (segment?.kind !== 'cubic') throw new Error('Missing cubic fixture segment')
  return segment
}

function mapCurve(curve: PdfCurvePath, transform: (p: PagePoint) => PagePoint): PdfCurvePath {
  return {
    ...curve,
    start: transform(curve.start),
    segments: curve.segments.map((segment) => {
      if (segment.kind !== 'cubic') throw new Error('Not cubic')
      return {
        ...segment,
        control1: transform(segment.control1),
        control2: transform(segment.control2),
        end: transform(segment.end),
      }
    }),
  }
}

function reverseCurve(curve: PdfCurvePath): PdfCurvePath {
  const starts = [curve.start, ...curve.segments.slice(0, -1).map((part) => part.end)]
  return {
    ...curve,
    start: { ...curve.start },
    segments: curve.segments.map((_, index) => {
      const originalIndex = 3 - index
      const segment = cubicOf(curve, originalIndex)
      return {
        kind: 'cubic',
        control1: { ...segment.control2 },
        control2: { ...segment.control1 },
        end: { ...(starts[originalIndex] as PagePoint) },
      }
    }),
  }
}

function rotateStart(curve: PdfCurvePath, index: number): PdfCurvePath {
  const starts = [curve.start, ...curve.segments.slice(0, -1).map((part) => part.end)]
  return {
    ...curve,
    start: { ...(starts[index] as PagePoint) },
    segments: structuredClone([...curve.segments.slice(index), ...curve.segments.slice(0, index)]),
  }
}

function midpoint(curve: PdfCurvePath, index: number): PagePoint {
  const start = index === 0 ? curve.start : cubicOf(curve, index - 1).end
  const part = cubicOf(curve, index)
  return {
    x: (start.x + 3 * part.control1.x + 3 * part.control2.x + part.end.x) / 8,
    y: (start.y + 3 * part.control1.y + 3 * part.control2.y + part.end.y) / 8,
  }
}

function expectLocation(curve: PdfCurvePath, point: PagePoint, location: string) {
  const beforeCurve = structuredClone(curve),
    beforePoint = { ...point }
  const result = exactMonotoneCubicLoopLocation(curve, point)
  expect(result.location).toBe(location)
  expect(curve).toEqual(beforeCurve)
  expect(point).toEqual(beforePoint)
  expect(() => JSON.stringify(result)).not.toThrow()
  return result
}

const actualLoop: PdfCurvePath = {
  operationIndex: 10,
  subpathIndex: 0,
  operationSubpathCount: 1,
  paint: 'stroke',
  closed: true,
  start: { x: 916.777, y: 337.116 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 916.777, y: 331.858 },
      control2: { x: 910.749, y: 327.596 },
      end: { x: 903.312, y: 327.596 },
    },
    {
      kind: 'cubic',
      control1: { x: 895.872, y: 327.596 },
      control2: { x: 889.844, y: 331.858 },
      end: { x: 889.844, y: 337.116 },
    },
    {
      kind: 'cubic',
      control1: { x: 889.844, y: 342.376 },
      control2: { x: 895.872, y: 346.638 },
      end: { x: 903.312, y: 346.638 },
    },
    {
      kind: 'cubic',
      control1: { x: 910.749, y: 346.638 },
      control2: { x: 916.777, y: 342.376 },
      end: { x: 916.777, y: 337.116 },
    },
  ],
}

describe('exact location in the actual four-cubic loop', () => {
  it('recognizes the center using an exact half-open horizontal ray', () => {
    const result = expectLocation(fixture(), { x: 400, y: 400 }, 'inside')
    expect(result.proof?.crossings).toHaveLength(2)
    expect(result.proof?.crossings.filter((crossing) => crossing.crossesRight)).toHaveLength(1)
  })
  it.each([
    { x: 350, y: 400 },
    { x: 450, y: 400 },
    { x: 400, y: 350 },
    { x: 400, y: 450 },
    { x: 420, y: 420 },
  ])('recognizes an outside point %j', (point) => {
    expectLocation(fixture(), point, 'outside')
  })
  it.each([
    { x: 390, y: 400 },
    { x: 410, y: 400 },
    { x: 400, y: 390 },
    { x: 400, y: 410 },
  ])('recognizes an interior point %j', (point) => {
    expectLocation(fixture(), point, 'inside')
  })
  it.each([0, 1, 2, 3])('recognizes exact source vertex %i', (index) => {
    const curve = fixture()
    const start = rotateStart(curve, index).start
    const result = expectLocation(curve, start, 'boundary')
    expect(result.proof?.boundary?.parameter).toEqual({ numerator: '0', denominator: '1' })
  })
  it.each([0, 1, 2, 3])('recognizes the exact dyadic curve midpoint %i', (index) => {
    const curve = fixture()
    const result = expectLocation(curve, midpoint(curve, index), 'boundary')
    expect(result.proof?.boundary?.parameter).toEqual({ numerator: '1', denominator: '2' })
  })
  it.each([0, 1, 2, 3])('is independent of source start quarter %i', (index) => {
    const curve = rotateStart(fixture(), index)
    expectLocation(curve, { x: 400, y: 400 }, 'inside')
    expectLocation(curve, { x: 422 - 1e-9, y: 411 }, 'inside')
    expectLocation(curve, { x: 422 + 1e-9, y: 411 }, 'outside')
  })
  it('is independent of source orientation', () => {
    const curve = reverseCurve(fixture())
    expectLocation(curve, { x: 400, y: 400 }, 'inside')
    expectLocation(curve, { x: 422 - 1e-9, y: 411 }, 'inside')
    expectLocation(curve, { x: 422 + 1e-9, y: 411 }, 'outside')
  })
  it.each([
    (p: PagePoint) => ({ x: 800 - p.x, y: p.y }),
    (p: PagePoint) => ({ x: p.x, y: 800 - p.y }),
    (p: PagePoint) => ({ x: p.y, y: p.x }),
    (p: PagePoint) => ({ x: 800 - p.y, y: p.x }),
    (p: PagePoint) => ({ x: p.x / 2, y: p.y * 2 }),
  ])('preserves exact reflection, quarter rotation, or aspect-scaled locations', (transform) => {
    const curve = mapCurve(fixture(), transform)
    expectLocation(curve, transform({ x: 400, y: 400 }), 'inside')
    expectLocation(curve, transform({ x: 422 - 1e-9, y: 411 }), 'inside')
    expectLocation(curve, transform({ x: 422 + 1e-9, y: 411 }), 'outside')
    expectLocation(curve, transform(midpoint(fixture(), 2)), 'boundary')
  })
  it('does not classify an exact non-dyadic boundary by a tolerance', () => {
    const result = expectLocation(fixture(), { x: 422, y: 411 }, 'unresolved')
    expect(result.reason).toBe('cubic-ray-separation-limit')
  })
  it('checks many dyadic curve points and their 1e-9 neighborhoods in every quadrant', () => {
    const curve = fixture()
    const starts = [curve.start, ...curve.segments.slice(0, -1).map((part) => part.end)]
    for (let quarter = 0; quarter < 4; quarter++) {
      const start = starts[quarter] as PagePoint
      const part = cubicOf(curve, quarter)
      for (let numerator = 1; numerator < 16; numerator++) {
        const from = 16 - numerator
        const weights = [
          from ** 3,
          3 * from ** 2 * numerator,
          3 * from * numerator ** 2,
          numerator ** 3,
        ]
        const points = [start, part.control1, part.control2, part.end]
        const point = points.reduce(
          (sum, p, index) => ({
            x: sum.x + (p.x * (weights[index] as number)) / 4096,
            y: sum.y + (p.y * (weights[index] as number)) / 4096,
          }),
          { x: 0, y: 0 },
        )
        expectLocation(curve, point, 'boundary')
        const towardCenter = point.x > 400 ? -1 : 1
        expectLocation(curve, { x: point.x + towardCenter * 1e-9, y: point.y }, 'inside')
        expectLocation(curve, { x: point.x - towardCenter * 1e-9, y: point.y }, 'outside')
      }
    }
  })
  it('distinguishes an inside point only 1e-9 away from a non-dyadic boundary', () => {
    expectLocation(fixture(), { x: 422 - 1e-9, y: 411 }, 'inside')
  })
  it('distinguishes an outside point only 1e-9 away from a non-dyadic boundary', () => {
    expectLocation(fixture(), { x: 422 + 1e-9, y: 411 }, 'outside')
  })
  it('uses actual cubic controls when the observed-extrema ellipse places the point outside', () => {
    const point = { x: 889.91, y: 338.064 }
    const ellipseScore =
      ((2 * point.x - 889.844 - 916.777) / (916.777 - 889.844)) ** 2 +
      ((2 * point.y - 327.596 - 346.638) / (346.638 - 327.596)) ** 2
    expect(ellipseScore).toBeGreaterThan(1)
    const result = expectLocation(actualLoop, point, 'inside')
    expect(result.proof?.crossings).toHaveLength(2)
  })
  it.each([0, 1, 2, 3])('preserves actual source vertex %i without model fitting', (index) => {
    const vertex = rotateStart(actualLoop, index).start
    expectLocation(actualLoop, vertex, 'boundary')
  })
  it('keeps the literal curve centerline inside despite unequal extrema-derived half radii', () => {
    expectLocation(actualLoop, { x: 903.312, y: 337.116 }, 'inside')
  })
  it('does not use bounding rectangles as curved interiors', () => {
    expectLocation(actualLoop, { x: 890, y: 328 }, 'outside')
  })
  it.each([
    { x: 390, y: 373 },
    { x: 410, y: 373 },
    { x: 390, y: 427 },
    { x: 410, y: 427 },
  ])('cancels ray intersections at an extremum %j', (point) => {
    expectLocation(fixture(), point, 'outside')
  })
  it('returns detached JSON-safe rational proof strings', () => {
    const curve = fixture()
    const result = expectLocation(curve, { x: 422 - 1e-9, y: 411 }, 'inside')
    expect(result.proof?.method).toBe('exact-monotone-cubic-loop-ray')
    for (const crossing of result.proof?.crossings ?? []) {
      for (const bound of [
        crossing.parameterInterval.lower,
        crossing.parameterInterval.upper,
        crossing.xInterval.lower,
        crossing.xInterval.upper,
      ]) {
        expect(bound.numerator).toMatch(/^\d+$/u)
        expect(bound.denominator).toMatch(/^[1-9]\d*$/u)
      }
    }
    const before = structuredClone(curve)
    const crossing = result.proof?.crossings[0]
    if (!crossing) throw new Error('Missing proof')
    crossing.xInterval.lower.numerator = '999'
    expect(curve).toEqual(before)
  })
  it('supports bounded scientific decimal notation', () => {
    const transform = (p: PagePoint) => ({ x: p.x / 1000000, y: p.y / 1000000 })
    expectLocation(mapCurve(fixture(), transform), transform({ x: 400, y: 400 }), 'inside')
  })
  it('supports the exact 18-decimal precision boundary', () => {
    const curve = mapCurve(fixture(), (p) => ({ x: p.x / 1e18, y: p.y / 1e18 }))
    expectLocation(curve, { x: 400 / 1e18, y: 400 / 1e18 }, 'inside')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1001, 1e-19])(
    'holds unsupported query coordinate %s',
    (value) => {
      const result = expectLocation(fixture(), { x: value, y: 400 }, 'unresolved')
      expect(result.reason).toBe('unsupported-cubic-coordinate')
    },
  )
  it.each([Number.NaN, -1, 1001, 1e-19])('holds unsupported source coordinate %s', (value) => {
    const curve = fixture()
    cubicOf(curve).control1.x = value
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('does not accept incomplete source closure', () => {
    const curve = fixture()
    cubicOf(curve, 3).end.x += 1e-9
    expect(expectLocation(curve, { x: 400, y: 400 }, 'unresolved').reason).toBe(
      'unclosed-cubic-loop',
    )
  })
  it('does not accept a false source closed flag', () => {
    const curve = fixture()
    curve.closed = false
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it.each(['fill', 'fill-stroke'] as const)(
    'does not accept %s glyph paths for this predicate',
    (paint) => {
      const curve = fixture()
      curve.paint = paint
      expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
    },
  )
  it('does not accept a compound source operation', () => {
    const curve = fixture()
    curve.operationSubpathCount = 2
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it.each([-1, 0.5, Number.NaN])('requires integer source reference %s', (operation) => {
    const curve = fixture()
    curve.operationIndex = operation
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('holds a missing segment', () => {
    const curve = fixture()
    curve.segments.pop()
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('holds an oversized segment list without iterating it', () => {
    const curve = fixture()
    curve.segments = Array.from({ length: 1000 }, () => structuredClone(cubicOf(curve)))
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('holds non-cubic segments', () => {
    const curve = fixture()
    curve.segments[0] = { kind: 'line', end: cubicOf(curve).end }
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('holds a malformed missing control point without throwing', () => {
    const curve = fixture()
    delete (cubicOf(curve) as Partial<Cubic>).control1
    expect(() => exactMonotoneCubicLoopLocation(curve, { x: 400, y: 400 })).not.toThrow()
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('rejects an infinitesimal control reversal, not a repaired monotone curve', () => {
    const curve = fixture()
    cubicOf(curve).control1.x += 1e-9
    expect(expectLocation(curve, { x: 400, y: 400 }, 'unresolved').reason).toBe(
      'non-monotone-cubic-quarter',
    )
  })
  it('rejects overlapping quadrant control hulls', () => {
    const curve = fixture()
    cubicOf(curve).control2.x = 390
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('does not accept a self-crossing cardinal-anchor order', () => {
    const curve = fixture()
    const parts = structuredClone(curve.segments)
    curve.segments = [parts[1] as Cubic, parts[0] as Cubic, parts[2] as Cubic, parts[3] as Cubic]
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('does not accept a missing or repeated cardinal anchor', () => {
    const curve = fixture()
    cubicOf(curve, 1).end = { ...cubicOf(curve).end }
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('does not fit rotated arbitrary control hulls back into an ellipse', () => {
    const angle = Math.PI / 4
    const curve = mapCurve(fixture(), (p) => ({
      x: 400 + (p.x - 400) * Math.cos(angle) - (p.y - 400) * Math.sin(angle),
      y: 400 + (p.x - 400) * Math.sin(angle) + (p.y - 400) * Math.cos(angle),
    }))
    expectLocation(curve, { x: 400, y: 400 }, 'unresolved')
  })
  it('does not accept a straight-line degenerate quarter as a glyph arc', () => {
    const curve = fixture()
    const part = cubicOf(curve)
    part.control1 = { x: 418, y: 409 }
    part.control2 = { x: 409, y: 418 }
    expect(expectLocation(curve, { x: 400, y: 400 }, 'unresolved').reason).toBe(
      'degenerate-cubic-quarter',
    )
  })
})
