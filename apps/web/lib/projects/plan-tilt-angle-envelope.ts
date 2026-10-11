/** Directed arithmetic enclosures, not physical fitting tolerances. */
const SCALE = 10n ** 48n
type Interval = { lower: bigint; upper: bigint }

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

function decimalFraction(value: number) {
  const [mantissa = '', exponent = '0'] = value.toString().split('e')
  const [whole = '', fraction = ''] = mantissa.split('.')
  const places = fraction.length - Number(exponent)
  const digits = BigInt(whole + fraction)
  return places >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(places) }
    : { numerator: digits * 10n ** BigInt(-places), denominator: 1n }
}

function decimalInterval(value: number): Interval {
  const { numerator, denominator } = decimalFraction(value)
  return {
    lower: (numerator * SCALE) / denominator,
    upper: ceilDivide(numerator * SCALE, denominator),
  }
}

/** Only used for nonnegative intervals (angles, powers, dimensions and trig bounds). */
function multiply(left: Interval, right: Interval): Interval {
  return {
    lower: (left.lower * right.lower) / SCALE,
    upper: ceilDivide(left.upper * right.upper, SCALE),
  }
}

function divide(value: Interval, divisor: bigint): Interval {
  return { lower: value.lower / divisor, upper: ceilDivide(value.upper, divisor) }
}

function add(left: Interval, right: Interval): Interval {
  return { lower: left.lower + right.lower, upper: left.upper + right.upper }
}

function subtract(left: Interval, right: Interval): Interval {
  return { lower: left.lower - right.upper, upper: left.upper - right.lower }
}

function inverseTangent(denominator: bigint, terms: number): Interval {
  let result: Interval = { lower: 0n, upper: 0n }
  let power = denominator
  for (let index = 0; index < terms; index += 1) {
    const divisor = power * BigInt(2 * index + 1)
    const term = { lower: SCALE / divisor, upper: ceilDivide(SCALE, divisor) }
    result = index % 2 === 0 ? add(result, term) : subtract(result, term)
    power *= denominator * denominator
  }
  // Alternating arctan series: the signed remainder is bounded by the next term.
  const remainder = ceilDivide(SCALE, power * BigInt(2 * terms + 1))
  if (terms % 2 === 0) result.upper += remainder
  else result.lower -= remainder
  return result
}

function piInterval(): Interval {
  // Machin's identity follows from tan(4 atan(1/5) - atan(1/239)) = 1
  // with the angle in (0, pi/2). No rounded Math.PI is used as evidence.
  const fifth = inverseTangent(5n, 40)
  const other = inverseTangent(239n, 12)
  return {
    lower: 16n * fifth.lower - 4n * other.upper,
    upper: 16n * fifth.upper - 4n * other.lower,
  }
}

const PI = piInterval()

function trigInterval(angle: Interval, kind: 'sin' | 'cos'): Interval {
  const squaredAngle = multiply(angle, angle)
  let power: Interval = kind === 'sin' ? angle : { lower: SCALE, upper: SCALE }
  let factorial = 1n
  let result: Interval = { lower: 0n, upper: 0n }
  const firstDegree = kind === 'sin' ? 1 : 0
  for (let index = 0; index <= 24; index += 1) {
    const term = divide(power, factorial)
    result = index % 2 === 0 ? add(result, term) : subtract(result, term)
    const degree = firstDegree + 2 * index
    power = multiply(power, squaredAngle)
    factorial *= BigInt(degree + 1) * BigInt(degree + 2)
  }
  // Lagrange remainder after degree 49 (sin) / 48 (cos), since all
  // derivatives have absolute value <= 1. Use the next degree, not samples.
  const lastDegree = firstDegree + 48
  let remainderPower: Interval = { lower: SCALE, upper: SCALE }
  let remainderFactorial = 1n
  for (let degree = 1; degree <= lastDegree + 1; degree += 1) {
    remainderPower = multiply(remainderPower, angle)
    remainderFactorial *= BigInt(degree)
  }
  const remainder = ceilDivide(remainderPower.upper, remainderFactorial)
  return {
    lower: result.lower - remainder > 0n ? result.lower - remainder : 0n,
    upper: result.upper + remainder < SCALE ? result.upper + remainder : SCALE,
  }
}

function enclosingNumber(upper: bigint): number | undefined {
  let candidate = Number(`${upper}e-48`)
  const view = new DataView(new ArrayBuffer(8))
  for (let attempt = 0; attempt < 16 && Number.isFinite(candidate); attempt += 1) {
    const exact = decimalFraction(candidate)
    if (exact.numerator * SCALE >= upper * exact.denominator) return candidate
    view.setFloat64(0, candidate)
    view.setBigUint64(0, view.getBigUint64(0) + 1n)
    candidate = view.getFloat64(0)
  }
  return undefined
}

/**
 * A certified enclosing axis-aligned box for one entered tilt pose, 0..90 degrees.
 * This does not certify the swept rotation, support, lifting effort, or a route.
 * Dimensions denote decimal centimetres, consistent with the geometry core.
 */
export function tiltedBoxEnvelope(
  dimensionCm: number,
  heightCm: number,
  angleDeg: number,
): { extentCm: number; heightCm: number } | undefined {
  if (
    ![dimensionCm, heightCm, angleDeg].every(Number.isFinite) ||
    dimensionCm <= 0 ||
    heightCm <= 0 ||
    angleDeg < 0 ||
    angleDeg > 90
  )
    return undefined
  if (angleDeg === 0) return { extentCm: dimensionCm, heightCm }
  if (angleDeg === 90) return { extentCm: heightCm, heightCm: dimensionCm }
  const angle = divide(multiply(decimalInterval(angleDeg), PI), 180n)
  const sin = trigInterval(angle, 'sin')
  const cos = trigInterval(angle, 'cos')
  const dimension = decimalInterval(dimensionCm)
  const height = decimalInterval(heightCm)
  const extentCm = enclosingNumber(add(multiply(dimension, cos), multiply(height, sin)).upper)
  const tiltedHeightCm = enclosingNumber(add(multiply(dimension, sin), multiply(height, cos)).upper)
  if (extentCm === undefined || tiltedHeightCm === undefined) return undefined
  return { extentCm, heightCm: tiltedHeightCm }
}
