import type { ImageContourPoint } from './plan-image-contour'
import { validRasterRegionPolygon } from './plan-raster-regions'

export type RasterRegionGuide = {
  id: string
  polygon: ImageContourPoint[]
  hasInteriorIslands: boolean
}

export type RasterRegionGuides = {
  regions: RasterRegionGuide[]
  uncertain: boolean
}

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

function matchingRasterSource(
  value: unknown,
  width: number,
  height: number,
  page: number,
  sha256?: string,
): Record<string, unknown> | undefined {
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
    (sha256 && source.sha256 !== sha256)
  )
    return undefined
  return data
}

export function rasterCornerResponse(
  value: unknown,
  width: number,
  height: number,
  page: number,
  sha256?: string,
): ImageContourPoint[] | undefined {
  const data = matchingRasterSource(value, width, height, page, sha256)
  if (!data) return undefined
  if (
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

/** Source-bound bright pixel components are visual guides, never measured floor polygons. */
export function rasterRegionResponse(
  value: unknown,
  width: number,
  height: number,
  page: number,
  sha256?: string,
): RasterRegionGuides | undefined {
  const data = matchingRasterSource(value, width, height, page, sha256)
  if (!data) return undefined
  if (
    data.regionTruncated !== false ||
    typeof data.regionUncertain !== 'boolean' ||
    !Array.isArray(data.regions) ||
    data.regions.length > 50
  )
    return undefined
  const regions: RasterRegionGuide[] = []
  const ids = new Set<string>()
  let pointCount = 0
  for (const entry of data.regions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const region = entry as Record<string, unknown>
    if (
      typeof region.id !== 'string' ||
      !/^region-[1-9]\d*$/.test(region.id) ||
      ids.has(region.id) ||
      typeof region.hasInteriorIslands !== 'boolean' ||
      !Array.isArray(region.polygon) ||
      region.polygon.length < 3 ||
      region.polygon.length > 200
    )
      return undefined
    const polygon: ImageContourPoint[] = []
    for (const entry of region.polygon) {
      if (!entry || typeof entry !== 'object') return undefined
      const { x, y } = entry as ImageContourPoint
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height)
        return undefined
      polygon.push({ x, y })
    }
    pointCount += polygon.length
    if (pointCount > 10_000 || !validRasterRegionPolygon(polygon)) return undefined
    ids.add(region.id)
    regions.push({ id: region.id, polygon, hasInteriorIslands: region.hasInteriorIslands })
  }
  return { regions, uncertain: data.regionUncertain }
}

/** A click only selects one unclassified component; it does not change the tracing draft. */
export function rasterRegionAt(
  point: ImageContourPoint,
  regions: readonly RasterRegionGuide[],
): RasterRegionGuide | undefined {
  let match: RasterRegionGuide | undefined
  for (const region of regions) {
    let inside = false
    const vertices = region.polygon
    for (let index = 0; index < vertices.length; index++) {
      const a = vertices[index]
      const b = vertices[(index + vertices.length - 1) % vertices.length]
      if (!a || !b) continue
      const crossesRay = a.y > point.y !== b.y > point.y
      if (crossesRay && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside
    }
    if (!inside) continue
    if (match) return undefined
    match = region
  }
  return match
}

/** Long straight stretches of the pixel boundary, not evidence of a physical wall. */
export function rasterRegionStraightEdges(
  region: RasterRegionGuide,
  width: number,
  height: number,
): { start: ImageContourPoint; end: ImageContourPoint }[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
  const minimumLength = Math.max(20, Math.min(width, height) * 0.06)
  return region.polygon.flatMap((start, index) => {
    const end = region.polygon[(index + 1) % region.polygon.length]
    if (!end || Math.hypot(end.x - start.x, end.y - start.y) < minimumLength) return []
    return [{ start, end }]
  })
}
