import type { PlanPoint } from '@uyut/db'

export type IntegerPoint = { x: bigint; y: bigint }

/** Exact decimal coordinates, not a physical snapping or measurement tolerance. */
export function integerPoints(points: readonly PlanPoint[]): IntegerPoint[] {
  const values = points
    .flatMap(({ xCm, yCm }) => [xCm, yCm])
    .map((value) => {
      if (!Number.isFinite(value)) throw new Error('Invalid geometric coordinate')
      const [mantissa = '', exponent = '0'] = value.toString().split('e')
      const [whole = '', fraction = ''] = mantissa.split('.')
      const places = fraction.length - Number(exponent)
      return {
        integer: BigInt(whole + fraction) * (places < 0 ? 10n ** BigInt(-places) : 1n),
        places: Math.max(0, places),
      }
    })
  const precision = Math.max(0, ...values.map(({ places }) => places))
  const coordinates = values.map(
    ({ integer, places }) => integer * 10n ** BigInt(precision - places),
  )
  return points.map((_point, index) => ({
    x: coordinates[index * 2] as bigint,
    y: coordinates[index * 2 + 1] as bigint,
  }))
}

export const vector = (a: IntegerPoint, b: IntegerPoint): IntegerPoint => ({
  x: b.x - a.x,
  y: b.y - a.y,
})
export const cross = (a: IntegerPoint, b: IntegerPoint): bigint => a.x * b.y - a.y * b.x
export const dot = (a: IntegerPoint, b: IntegerPoint): bigint => a.x * b.x + a.y * b.y
export const sign = (value: bigint): number => (value < 0n ? -1 : value > 0n ? 1 : 0)

export function onIntegerSegment(
  point: IntegerPoint,
  start: IntegerPoint,
  end: IntegerPoint,
): boolean {
  const direction = vector(start, end)
  if (direction.x === 0n && direction.y === 0n) return false
  const offset = vector(start, point)
  return (
    cross(direction, offset) === 0n &&
    dot(offset, direction) >= 0n &&
    dot(offset, direction) <= dot(direction, direction)
  )
}

export function exactSegmentContains(
  start: PlanPoint,
  end: PlanPoint,
  points: readonly PlanPoint[],
): boolean {
  const [a, b, ...vertices] = integerPoints([start, end, ...points])
  return Boolean(
    a &&
      b &&
      (a.x !== b.x || a.y !== b.y) &&
      vertices.every((point) => onIntegerSegment(point, a, b)),
  )
}
