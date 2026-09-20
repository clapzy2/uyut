import type { PlanPoint } from '@uyut/db'

export const MAX_ROOM_CONTOUR_POINTS = 30

function edgeLength(start: PlanPoint, end: PlanPoint): number {
  return Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm)
}

/**
 * Делит самую длинную сторону пополам. Форма и площадь не меняются, пока человек
 * не сдвинет новую точку: это безопасная отправная точка для ниши или эркера.
 */
export function addRoomContourPoint(points: readonly PlanPoint[]): PlanPoint[] {
  if (points.length < 2 || points.length >= MAX_ROOM_CONTOUR_POINTS) return [...points]

  let longestStart = 0
  let longestLength = -1
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    if (!start || !end) continue
    const length = edgeLength(start, end)
    if (length > longestLength) {
      longestLength = length
      longestStart = index
    }
  }

  const start = points[longestStart]
  const end = points[(longestStart + 1) % points.length]
  if (!start || !end || longestLength < 2) return [...points]
  const inserted = {
    xCm: Math.round((start.xCm + end.xCm) / 2),
    yCm: Math.round((start.yCm + end.yCm) / 2),
  }
  const next = [...points]
  next.splice(longestStart + 1, 0, inserted)
  return next
}

export function removeRoomContourPoint(
  points: readonly PlanPoint[],
  pointIndex: number,
): PlanPoint[] {
  if (points.length <= 3 || pointIndex < 0 || pointIndex >= points.length) return [...points]
  return points.filter((_, index) => index !== pointIndex)
}
