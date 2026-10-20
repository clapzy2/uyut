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

export type RasterSourceStrokeGuide = {
  regionId: string
  edges: Array<{
    index: number
    status: 'nearby' | 'none' | 'held'
    strokes: Array<{
      operationIndex: number
      subpathIndex: number
      segmentIndex: number
      start: ImageContourPoint
      end: ImageContourPoint
    }>
  }>
}

/** A model-read label can guide the eye only on the exact image it came from. */
export function rasterLabelPoint(
  anchor: { x: number; y: number; sourceSha256?: string; page?: number } | undefined,
  source: { width: number; height: number; sha256?: string; page: number },
): ImageContourPoint | undefined {
  if (
    !anchor ||
    !source.sha256 ||
    anchor.sourceSha256 !== source.sha256 ||
    anchor.page !== source.page ||
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y) ||
    anchor.x < 0 ||
    anchor.x > 1000 ||
    anchor.y < 0 ||
    anchor.y > 1000
  )
    return undefined
  return { x: (anchor.x * source.width) / 1000, y: (anchor.y * source.height) / 1000 }
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

export function rasterCandidateSourceSha256(
  value: unknown,
  width: number,
  height: number,
  page: number,
  sha256?: string,
): string | undefined {
  const data = matchingRasterSource(value, width, height, page, sha256)
  return (data?.source as { sha256: string } | undefined)?.sha256
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
  const complete = data.truncated === false && data.uncertain === false
  const focused = data.focused === true && data.truncated === false && data.uncertain === true
  const safePartial =
    data.truncated === true && data.uncertain === true && data.partialClosedContours === true
  if (
    (!complete && !focused && !safePartial) ||
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

/** Bounded same-source PDF ink proximity for one focused region; not a floor proof. */
export function rasterSourceStrokeResponse(
  value: unknown,
  width: number,
  height: number,
  page: number,
  regions: readonly RasterRegionGuide[],
  sha256?: string,
): RasterSourceStrokeGuide | undefined {
  const data = matchingRasterSource(value, width, height, page, sha256)
  const guide = data?.sourceStrokeGuide
  if (!guide || typeof guide !== 'object' || Array.isArray(guide)) return undefined
  const entry = guide as Record<string, unknown>
  const region = regions.find((candidate) => candidate.id === entry.regionId)
  if (!region || !Array.isArray(entry.edges)) return undefined
  const expectedEdges = rasterRegionStraightEdges(region, width, height)
  if (entry.edges.length !== expectedEdges.length || entry.edges.length > 40) return undefined
  const edges: RasterSourceStrokeGuide['edges'] = []
  for (const [index, rawEdge] of entry.edges.entries()) {
    if (!rawEdge || typeof rawEdge !== 'object' || Array.isArray(rawEdge)) return undefined
    const edge = rawEdge as Record<string, unknown>
    if (
      edge.index !== index ||
      (edge.status !== 'nearby' && edge.status !== 'none' && edge.status !== 'held') ||
      !Array.isArray(edge.strokes) ||
      edge.strokes.length > 20 ||
      (edge.status === 'nearby') !== edge.strokes.length > 0
    )
      return undefined
    const expected = expectedEdges[index]
    if (!expected) return undefined
    const strokes: RasterSourceStrokeGuide['edges'][number]['strokes'] = []
    const refs = new Set<string>()
    for (const rawStroke of edge.strokes) {
      if (!rawStroke || typeof rawStroke !== 'object' || Array.isArray(rawStroke)) return undefined
      const stroke = rawStroke as Record<string, unknown>
      const start = stroke.start as ImageContourPoint | undefined
      const end = stroke.end as ImageContourPoint | undefined
      const ref = `${stroke.operationIndex}:${stroke.subpathIndex}:${stroke.segmentIndex}`
      if (
        ![stroke.operationIndex, stroke.subpathIndex, stroke.segmentIndex].every(
          (part) => Number.isSafeInteger(part) && Number(part) >= 0,
        ) ||
        refs.has(ref) ||
        !start ||
        !end ||
        ![start.x, start.y, end.x, end.y].every(Number.isFinite) ||
        [start, end].some(
          (point) =>
            point.x < 0 ||
            point.y < 0 ||
            point.x > width ||
            point.y > height ||
            distanceToSegmentSquared(point, expected.start, expected.end) > 0.01,
        )
      )
        return undefined
      refs.add(ref)
      strokes.push({
        operationIndex: Number(stroke.operationIndex),
        subpathIndex: Number(stroke.subpathIndex),
        segmentIndex: Number(stroke.segmentIndex),
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
      })
    }
    edges.push({ index, status: edge.status, strokes })
  }
  return { regionId: region.id, edges }
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

function distanceToSegmentSquared(
  point: ImageContourPoint,
  start: ImageContourPoint,
  end: ImageContourPoint,
): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const position =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        )
  return (point.x - start.x - position * dx) ** 2 + (point.y - start.y - position * dy) ** 2
}

/** A visual tracing draft only. Never turns a bright region into proven floor geometry. */
export function rasterRegionTraceDraft(
  region: RasterRegionGuide,
  maxPoints: number,
): ImageContourPoint[] | undefined {
  if (!Number.isInteger(maxPoints) || maxPoints < 3 || !validRasterRegionPolygon(region.polygon))
    return undefined

  const original = region.polygon
  const keptIndexes = original.map((_, index) => index)
  const maximumDeviationSquared = 2 ** 2
  while (keptIndexes.length > maxPoints) {
    let bestIndex = -1
    let bestDeviation = Number.POSITIVE_INFINITY
    for (let index = 0; index < keptIndexes.length; index++) {
      const previous =
        original[keptIndexes[(index - 1 + keptIndexes.length) % keptIndexes.length] ?? -1]
      const point = original[keptIndexes[index] ?? -1]
      const next = original[keptIndexes[(index + 1) % keptIndexes.length] ?? -1]
      if (!previous || !point || !next) return undefined
      const deviation = distanceToSegmentSquared(point, previous, next)
      if (deviation < bestDeviation) {
        bestDeviation = deviation
        bestIndex = index
      }
    }
    if (bestIndex < 0 || bestDeviation > maximumDeviationSquared) return undefined
    keptIndexes.splice(bestIndex, 1)
  }

  const draft = keptIndexes.map((index) => original[index]).filter((point) => point !== undefined)
  if (!validRasterRegionPolygon(draft)) return undefined
  for (let index = 0; index < keptIndexes.length; index++) {
    const startIndex = keptIndexes[index]
    const endIndex = keptIndexes[(index + 1) % keptIndexes.length]
    if (startIndex === undefined || endIndex === undefined) return undefined
    const start = original[startIndex]
    const end = original[endIndex]
    if (!start || !end) return undefined
    for (
      let at = (startIndex + 1) % original.length;
      at !== endIndex;
      at = (at + 1) % original.length
    ) {
      const point = original[at]
      if (!point || distanceToSegmentSquared(point, start, end) > maximumDeviationSquared)
        return undefined
    }
  }
  return draft.map((point) => ({ ...point }))
}

/** Long pixel stretches. Connected ends are safer tracing starts, not physical-wall proof. */
export function rasterRegionStraightEdges(
  region: RasterRegionGuide,
  width: number,
  height: number,
): {
  start: ImageContourPoint
  end: ImageContourPoint
  connectedAtBothEnds: boolean
}[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
  const minimumLength = Math.max(20, Math.min(width, height) * 0.06)
  const lengths = region.polygon.map((start, index) => {
    const end = region.polygon[(index + 1) % region.polygon.length]
    return end ? Math.hypot(end.x - start.x, end.y - start.y) : 0
  })
  return region.polygon.flatMap((start, index) => {
    const end = region.polygon[(index + 1) % region.polygon.length]
    const previousLength = lengths[(index - 1 + lengths.length) % lengths.length] ?? 0
    const nextLength = lengths[(index + 1) % lengths.length] ?? 0
    if (
      !end ||
      (lengths[index] ?? 0) < minimumLength ||
      (previousLength < minimumLength && nextLength < minimumLength)
    )
      return []
    return [
      {
        start,
        end,
        connectedAtBothEnds: previousLength >= minimumLength && nextLength >= minimumLength,
      },
    ]
  })
}
