import type { PagePoint } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

// Interpret the extractor's decimal coordinates exactly. Never round or snap them.
const decimals = new Map<number, { value: bigint; places: number }>()
function decimal(value: number) {
  const cached = decimals.get(value)
  if (cached) return cached
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null
  const [mantissa = '', exponent = '0'] = value.toString().split('e')
  const [whole = '', fraction = ''] = mantissa.split('.')
  const places = fraction.length - Number(exponent)
  if (places > 18 || places < -3) return null
  const result = {
    value: BigInt(whole + fraction) * (places < 0 ? 10n ** BigInt(-places) : 1n),
    places: Math.max(0, places),
  }
  // Bound process-wide cache; this is only a performance cache, not evidence storage.
  if (decimals.size < 40_000) decimals.set(value, result)
  return result
}
function integerPoints(points: PagePoint[]) {
  const values = points.flatMap((point) => [decimal(point.x), decimal(point.y)])
  if (values.some((value) => !value)) return null
  const places = Math.max(...values.map((value) => value?.places ?? 0))
  const scaled = values.map(
    (value) => (value?.value ?? 0n) * 10n ** BigInt(places - (value?.places ?? 0)),
  )
  return {
    points: points.map((_, index) => ({
      x: scaled[index * 2] as bigint,
      y: scaled[index * 2 + 1] as bigint,
    })),
    scale: 10n ** BigInt(places),
  }
}
type IntegerPoint = { x: bigint; y: bigint }
type IntegerEdge = { start: IntegerPoint; end: IntegerPoint }
function integerOrientation(a: IntegerPoint, b: IntegerPoint, p: IntegerPoint) {
  const value = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  return value < 0n ? -1 : value > 0n ? 1 : 0
}
function integerEdges(polygon: IntegerPoint[]): IntegerEdge[] {
  return polygon.map((start, index) => ({
    start,
    end: polygon[(index + 1) % polygon.length] as IntegerPoint,
  }))
}
function integerWinding(polygon: IntegerPoint[]) {
  const area = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    return next ? sum + point.x * next.y - next.x * point.y : sum
  }, 0n)
  return area === 0n ? null : area > 0n ? 1 : -1
}
function integerPointLocation(point: IntegerPoint, boundary: IntegerEdge[], denominator = 1n) {
  let count = 0
  for (const edge of boundary) {
    const start = { x: edge.start.x * denominator, y: edge.start.y * denominator }
    const end = { x: edge.end.x * denominator, y: edge.end.y * denominator }
    const direction = integerOrientation(start, end, point)
    if (
      direction === 0 &&
      point.x >= (start.x < end.x ? start.x : end.x) &&
      point.x <= (start.x > end.x ? start.x : end.x) &&
      point.y >= (start.y < end.y ? start.y : end.y) &&
      point.y <= (start.y > end.y ? start.y : end.y)
    )
      return 'boundary' as const
    if (start.y <= point.y && end.y > point.y && direction > 0) count++
    if (start.y > point.y && end.y <= point.y && direction < 0) count--
  }
  return count !== 0 ? ('inside' as const) : ('outside' as const)
}
function reduced(numerator: bigint, denominator: bigint) {
  let a = numerator < 0n ? -numerator : numerator,
    b = denominator
  while (b) {
    const remainder = a % b
    a = b
    b = remainder
  }
  const divisor = a || 1n
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}
function ratio(numerator: bigint, denominator: bigint) {
  const value = reduced(numerator, denominator)
  return Number(value.numerator) / Number(value.denominator)
}
function fractionKey(numerator: bigint, denominator: bigint) {
  const value = reduced(numerator, denominator)
  return `${value.numerator}/${value.denominator}`
}
export function exactNativePointKey(point: PagePoint) {
  const x = decimal(point.x),
    y = decimal(point.y)
  if (!x || !y) return null
  return `${fractionKey(x.value, 10n ** BigInt(x.places))}:${fractionKey(y.value, 10n ** BigInt(y.places))}`
}
export function exactNativeOrientation(a: PagePoint, b: PagePoint, p: PagePoint) {
  const integers = integerPoints([a, b, p])
  if (!integers) return null
  const [first, second, third] = integers.points
  if (!first || !second || !third) return null
  const determinant =
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
  return determinant < 0n ? -1 : determinant > 0n ? 1 : 0
}

/** Location in an already validated simple source polygon, without an epsilon. */
export function exactNativePointLocation(polygon: readonly PagePoint[], point: PagePoint) {
  if (polygon.length < 3 || polygon.length > 100) return 'unresolved' as const
  const integers = integerPoints([...polygon, point])
  if (!integers) return 'unresolved' as const
  const boundary = integers.points.slice(0, polygon.length)
  const probe = integers.points[polygon.length]
  if (!probe || integerWinding(boundary) === null) return 'unresolved' as const
  return integerPointLocation(probe, integerEdges(boundary))
}

/** Signed winding of an already validated source polygon in the decimal domain. */
export function exactNativePolygonWinding(polygon: readonly PagePoint[]) {
  if (polygon.length < 3 || polygon.length > 100) return null
  const integers = integerPoints([...polygon])
  return integers ? integerWinding(integers.points) : null
}

/** Inclusive contact in the source-decimal domain; unknown precision is not a clear gap. */
export function exactNativeSegmentsTouch(
  first: Pick<NativePageSegment, 'start' | 'end'>,
  second: Pick<NativePageSegment, 'start' | 'end'>,
): boolean | null {
  const { start: a, end: b } = first
  const { start: c, end: d } = second
  if ([a, b, c, d].some((point) => exactNativePointKey(point) === null)) return null
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false
  const turns = [
    exactNativeOrientation(a, b, c),
    exactNativeOrientation(a, b, d),
    exactNativeOrientation(c, d, a),
    exactNativeOrientation(c, d, b),
  ]
  const [firstTurn, secondTurn, thirdTurn, fourthTurn] = turns
  if (firstTurn == null || secondTurn == null || thirdTurn == null || fourthTurn == null)
    return null
  return firstTurn * secondTurn <= 0 && thirdTurn * fourthTurn <= 0
}

/** Positive-area overlap in the bounded source-decimal domain. Shared borders alone do not overlap. */
export function exactNativePolygonsOverlap(
  first: readonly PagePoint[],
  second: readonly PagePoint[],
): boolean | null {
  if ([first, second].some((polygon) => polygon.length < 3 || polygon.length > 100)) return null
  const integers = integerPoints([...first, ...second])
  if (!integers) return null
  for (const axis of ['x', 'y'] as const) {
    if (
      Math.max(...first.map((point) => point[axis])) <=
        Math.min(...second.map((point) => point[axis])) ||
      Math.max(...second.map((point) => point[axis])) <=
        Math.min(...first.map((point) => point[axis]))
    )
      return false
  }
  const firstPoints = integers.points.slice(0, first.length)
  const secondPoints = integers.points.slice(first.length)
  const firstWinding = integerWinding(firstPoints),
    secondWinding = integerWinding(secondPoints)
  if (!firstWinding || !secondWinding) return null
  const firstEdges = integerEdges(firstPoints),
    secondEdges = integerEdges(secondPoints)
  const orientation = integerOrientation
  const min = (a: bigint, b: bigint) => (a < b ? a : b)
  const max = (a: bigint, b: bigint) => (a > b ? a : b)
  // Midpoint witnesses use a denominator of two in integer space, never rounded Numbers.
  const inside = (point: IntegerPoint, boundary: IntegerEdge[], denominator = 1n) =>
    integerPointLocation(point, boundary, denominator) === 'inside'
  for (const a of firstEdges)
    for (const b of secondEdges) {
      const c = orientation(a.start, a.end, b.start),
        d = orientation(a.start, a.end, b.end)
      const e = orientation(b.start, b.end, a.start),
        f = orientation(b.start, b.end, a.end)
      if (c * d < 0 && e * f < 0) return true
      if (c !== 0 || d !== 0) continue
      const axis = a.start.x !== a.end.x ? 'x' : 'y'
      if (
        max(min(a.start[axis], a.end[axis]), min(b.start[axis], b.end[axis])) >=
        min(max(a.start[axis], a.end[axis]), max(b.start[axis], b.end[axis]))
      )
        continue
      const sameDirection = a.start[axis] < a.end[axis] === b.start[axis] < b.end[axis]
      if (sameDirection === (firstWinding === secondWinding)) return true
    }
  for (const [polygonEdges, boundary] of [
    [firstEdges, secondEdges],
    [secondEdges, firstEdges],
  ] as const)
    for (const edge of polygonEdges) {
      if (inside(edge.start, boundary)) return true
      // Vertex-only crossings need every bounded subinterval checked, not just
      // the whole edge's midpoint. All probes remain rational integer witnesses.
      const axis = edge.start.x !== edge.end.x ? 'x' : 'y'
      const cuts = [
        edge.start,
        edge.end,
        ...boundary
          .map((other) => other.start)
          .filter(
            (point) =>
              orientation(edge.start, edge.end, point) === 0 &&
              point[axis] >= min(edge.start[axis], edge.end[axis]) &&
              point[axis] <= max(edge.start[axis], edge.end[axis]),
          ),
      ].sort((a, b) => (a[axis] < b[axis] ? -1 : a[axis] > b[axis] ? 1 : 0))
      for (let index = 1; index < cuts.length; index++) {
        const start = cuts[index - 1],
          end = cuts[index]
        if (!start || !end || start[axis] === end[axis]) continue
        if (inside({ x: start.x + end.x, y: start.y + end.y }, boundary, 2n)) return true
      }
    }
  return false
}

/** Inclusive containment of already validated simple, holeless source polygons.
 * Tests all bounded edge intervals exactly; never moves a vertex to a boundary.
 */
export function exactNativePolygonContains(
  outer: readonly PagePoint[],
  inner: readonly PagePoint[],
): boolean | null {
  if ([outer, inner].some((polygon) => polygon.length < 3 || polygon.length > 100)) return null
  const integers = integerPoints([...outer, ...inner])
  if (!integers) return null
  const outerPoints = integers.points.slice(0, outer.length)
  const innerPoints = integers.points.slice(outer.length)
  if (integerWinding(outerPoints) === null || integerWinding(innerPoints) === null) return null
  const boundary = integerEdges(outerPoints)
  for (const edge of integerEdges(innerPoints)) {
    if (integerPointLocation(edge.start, boundary) === 'outside') return false
    const axis = edge.start.x !== edge.end.x ? 'x' : 'y'
    const low = edge.start[axis] < edge.end[axis] ? edge.start[axis] : edge.end[axis]
    const high = edge.start[axis] > edge.end[axis] ? edge.start[axis] : edge.end[axis]
    const cuts = [edge.start, edge.end]
    for (const other of boundary) {
      const first = integerOrientation(edge.start, edge.end, other.start)
      const second = integerOrientation(edge.start, edge.end, other.end)
      const third = integerOrientation(other.start, other.end, edge.start)
      const fourth = integerOrientation(other.start, other.end, edge.end)
      if (first * second < 0 && third * fourth < 0) return false
      if (first === 0 && other.start[axis] >= low && other.start[axis] <= high)
        cuts.push(other.start)
    }
    cuts.sort((a, b) => (a[axis] < b[axis] ? -1 : a[axis] > b[axis] ? 1 : 0))
    for (let index = 1; index < cuts.length; index++) {
      const start = cuts[index - 1]
      const end = cuts[index]
      if (!start || !end || start[axis] === end[axis]) continue
      if (
        integerPointLocation({ x: start.x + end.x, y: start.y + end.y }, boundary, 2n) === 'outside'
      )
        return false
    }
  }
  return true
}
export function exactNativeCrossing(a: NativePageSegment, b: NativePageSegment) {
  const integers = integerPoints([a.start, a.end, b.start, b.end])
  if (!integers) return { reason: 'unsupported-coordinate-precision' as const }
  const [p, endP, q, endQ] = integers.points
  if (!p || !endP || !q || !endQ) return { reason: 'missing-intersection-coordinate' as const }
  const r = { x: endP.x - p.x, y: endP.y - p.y },
    s = { x: endQ.x - q.x, y: endQ.y - q.y },
    delta = { x: q.x - p.x, y: q.y - p.y }
  let determinant = r.x * s.y - r.y * s.x,
    t = delta.x * s.y - delta.y * s.x,
    u = delta.x * r.y - delta.y * r.x
  const physicalDeterminant = Math.abs(Number(determinant)) / Number(integers.scale) ** 2
  if (
    physicalDeterminant <=
    Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y) *
      Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) *
      1e-12
  )
    return { reason: 'ill-conditioned-intersection' as const }
  if (determinant < 0n) {
    determinant = -determinant
    t = -t
    u = -u
  }
  if (t <= 0n || t >= determinant || u <= 0n || u >= determinant)
    return { reason: 'unbounded-computed-intersection' as const }
  const x = p.x * determinant + t * r.x,
    y = p.y * determinant + t * r.y
  if (x !== q.x * determinant + u * s.x || y !== q.y * determinant + u * s.y)
    return { reason: 'inconsistent-computed-intersection' as const }
  const denominator = determinant * integers.scale
  const point = { x: ratio(x, denominator), y: ratio(y, denominator) }
  const parameters: [number, number] = [ratio(t, determinant), ratio(u, determinant)]
  if (
    ![point.x, point.y, ...parameters].every(Number.isFinite) ||
    !parameters.every((value) => value > 0 && value < 1)
  )
    return { reason: 'unrepresentable-intersection' as const }
  // Do not let a distinct rational intersection collapse onto a native endpoint as a Number.
  for (const [index, endpoint] of [a.start, a.end, b.start, b.end].entries()) {
    const integer = integers.points[index]
    if (
      point.x === endpoint.x &&
      point.y === endpoint.y &&
      integer &&
      (x !== integer.x * determinant || y !== integer.y * determinant)
    )
      return { reason: 'unrepresentable-intersection' as const }
  }
  return {
    point,
    parameters,
    exactPointKey: `${fractionKey(x, denominator)}:${fractionKey(y, denominator)}`,
  }
}
