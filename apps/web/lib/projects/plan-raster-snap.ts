import type { ImageContourPoint } from './plan-image-contour'

/** Explicit optional assistance. Ambiguous or distant candidates leave the pointer unchanged. */
export function snapRasterCorner(
  point: ImageContourPoint,
  candidates: readonly ImageContourPoint[],
  radiusPx = 8,
): ImageContourPoint | undefined {
  const nearby = candidates
    .map((candidate) => ({
      candidate,
      distance: Math.hypot(candidate.x - point.x, candidate.y - point.y),
    }))
    .filter((entry) => Number.isFinite(entry.distance) && entry.distance <= radiusPx)
    .sort((first, second) => first.distance - second.distance)
  const first = nearby[0]
  if (!first || (nearby[1] && nearby[1].distance - first.distance < 2)) return undefined
  return { ...first.candidate }
}

export function rasterCornerResponse(
  value: unknown,
  width: number,
  height: number,
  page: number,
  sha256?: string,
): ImageContourPoint[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  if (!data.source || typeof data.source !== 'object' || Array.isArray(data.source))
    return undefined
  const source = data.source as Record<string, unknown>
  if (
    source.width !== width ||
    source.height !== height ||
    source.page !== page ||
    typeof source.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    (sha256 && source.sha256 !== sha256) ||
    data.truncated !== false ||
    data.uncertain !== false ||
    !Array.isArray(data.points) ||
    data.points.length > 4000
  )
    return undefined
  const points: ImageContourPoint[] = []
  for (const entry of data.points) {
    if (!entry || typeof entry !== 'object') return undefined
    const { x, y } = entry as ImageContourPoint
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height)
      return undefined
    points.push({ x, y })
  }
  return points
}
