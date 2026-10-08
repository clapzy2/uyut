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
