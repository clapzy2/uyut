import { createHash } from 'node:crypto'
import { roomArchitectureFromPlan } from '@uyut/ai'
import type { PlanGeometry } from '@uyut/db'

/** A review becomes stale after replacing the plan, editing its geometry, or changing the render. */
export function planReviewSource(
  planKey: string | null,
  renderKey: string | null,
  geometry: PlanGeometry | undefined,
  roomName: string,
) {
  if (!planKey || !renderKey || !geometry) return null
  const architecture = roomArchitectureFromPlan(geometry, roomName)
  if (!architecture) return null
  const hash = createHash('sha256')
    .update(JSON.stringify([planKey, renderKey, geometry, roomName]))
    .digest('hex')
  return { hash, architecture }
}
