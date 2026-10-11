import { compareDecimalSums, integerPoints } from '@uyut/catalog/plan-exact-geometry'
import { signedElevationSum } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanPoint } from '@uyut/db'

/** Numeric enclosure only; never a physical fitting tolerance. */
function adjacentFloat(value: number, direction: 'up' | 'down'): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return direction === 'up' ? Number.MIN_VALUE : -Number.MIN_VALUE
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  const increment = value > 0 === (direction === 'up') ? 1n : -1n
  view.setBigUint64(0, view.getBigUint64(0) + increment)
  return view.getFloat64(0)
}

export function enclosingTurnSide(width: number, depth: number): number | undefined {
  let side = Math.hypot(width, depth)
  for (let attempt = 0; attempt < 16 && Number.isFinite(side); attempt += 1) {
    const [body, square] = integerPoints([
      { xCm: width, yCm: depth },
      { xCm: side, yCm: 0 },
    ])
    if (body && square && square.x * square.x >= body.x * body.x + body.y * body.y) return side
    side = adjacentFloat(side, 'up')
  }
  return undefined
}

export function enclosingTurnBounds(point: PlanPoint, width: number, depth: number, side: number) {
  let half = adjacentFloat(side / 2, 'up')
  let certified = false
  for (let attempt = 0; attempt < 16 && Number.isFinite(half); attempt += 1) {
    const [body, radius] = integerPoints([
      { xCm: width, yCm: depth },
      { xCm: half, yCm: 0 },
    ])
    if (body && radius && 4n * radius.x * radius.x >= body.x * body.x + body.y * body.y) {
      certified = true
      break
    }
    half = adjacentFloat(half, 'up')
  }
  if (!certified) return undefined
  const bounds: [number, number, number, number] = [
    adjacentFloat(point.xCm - half, 'down'),
    adjacentFloat(point.yCm - half, 'down'),
    adjacentFloat(point.xCm + half, 'up'),
    adjacentFloat(point.yCm + half, 'up'),
  ]
  for (let attempt = 0; attempt < 16 && bounds.every(Number.isFinite); attempt += 1) {
    const [body, centre, lower, upper] = integerPoints([
      { xCm: width, yCm: depth },
      point,
      { xCm: bounds[0], yCm: bounds[1] },
      { xCm: bounds[2], yCm: bounds[3] },
    ])
    if (!body || !centre || !lower || !upper) return undefined
    const diagonal = body.x * body.x + body.y * body.y
    const distances = [
      centre.x - lower.x,
      centre.y - lower.y,
      upper.x - centre.x,
      upper.y - centre.y,
    ]
    const failures = distances.map(
      (distance) => distance <= 0n || 4n * distance * distance < diagonal,
    )
    if (!failures.some(Boolean)) return bounds
    for (const [index, failed] of failures.entries()) {
      if (failed) bounds[index] = adjacentFloat(bounds[index] as number, index < 2 ? 'down' : 'up')
    }
  }
  return undefined
}

/** An outward enclosure of entered sums, not a physical clearance tolerance. */
export function enclosingDecimalSum(values: readonly number[]): number {
  let total = values.reduce((sum, value) => signedElevationSum(sum, value), 0)
  for (let attempt = 0; attempt < 16 && Number.isFinite(total); attempt += 1) {
    if (compareDecimalSums([total], values) >= 0) return total
    total = adjacentFloat(total, 'up')
  }
  throw new Error('Не удалось подтвердить численное ограждение габарита')
}
