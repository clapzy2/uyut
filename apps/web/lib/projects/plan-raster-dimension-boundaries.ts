import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import { bindObservedRegionLabels } from './plan-raster-region-labels'
import type { RasterRegionPoint } from './plan-raster-regions'

type Dimensions = ReturnType<typeof nativeDimensionEvidence>
const MAX_DISTANCE_PX = 2
const MIN_OVERLAP_PX = 5

function annotationOverlap(
  a: RasterRegionPoint,
  b: RasterRegionPoint,
  start: RasterRegionPoint,
  end: RasterRegionPoint,
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < MIN_OVERLAP_PX) return null
  const projection = (point: RasterRegionPoint) =>
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / length
  const distance = (point: RasterRegionPoint) =>
    Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length
  const maxDistancePx = Math.max(distance(a), distance(b))
  if (maxDistancePx > MAX_DISTANCE_PX) return null
  const first = projection(a)
  const last = projection(b)
  const overlapPx = Math.min(length, Math.max(first, last)) - Math.max(0, Math.min(first, last))
  return overlapPx >= MIN_OVERLAP_PX ? { overlapPx, maxDistancePx } : null
}

/** Block annotation-bounded candidates, never promote absence of a match to a verified floor. */
export function rasterDimensionBoundaryAudit(input: {
  native: NativeTextAnchors
  dimensions: Dimensions
  regions: { id: string; polygon: RasterRegionPoint[] }[]
}) {
  const { native, dimensions, regions } = input
  bindObservedRegionLabels({
    regionSource: native.source,
    labelSource: dimensions.rasterSource,
    regions,
    labels: [],
  })
  const scale = native.pageNormalizedScale
  if (
    !native.complete ||
    !scale ||
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    scale.x <= 0 ||
    scale.y <= 0 ||
    scale.x * 1000 > native.source.width + 0.001 ||
    scale.y * 1000 > native.source.height + 0.001 ||
    scale.x * 1000 < native.source.width * 0.995 ||
    scale.y * 1000 < native.source.height * 0.995 ||
    dimensions.status !== 'draft' ||
    !native.originalPdfSha256 ||
    !/^[a-f0-9]{64}$/.test(native.originalPdfSha256) ||
    dimensions.source.state !== 'existing' ||
    dimensions.source.sha256 !== native.originalPdfSha256 ||
    dimensions.source.pdfPage !== native.source.page ||
    dimensions.chains.length > 8
  )
    throw new Error('Dimension boundary evidence does not match the source raster')
  const spans: {
    chainId: string
    labelIndex: number
    operationIndex: number
    subpathIndex: number
    start: RasterRegionPoint
    end: RasterRegionPoint
  }[] = []
  for (const chain of dimensions.chains) {
    if (chain.result.status !== 'candidate') continue
    if (chain.result.segments.length > 20 || chain.result.segments.length !== chain.rails.length)
      throw new Error('Invalid native dimension segment inventory')
    for (const [index, segment] of chain.result.segments.entries()) {
      const rail = chain.rails[index]
      if (
        !rail ||
        rail.operationIndex !== chain.result.lineOperations[index] ||
        ![segment.start, segment.end].every((point) =>
          [point.x, point.y].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
          ),
        )
      )
        throw new Error('Dimension segment has no unique native rail')
      spans.push({
        chainId: chain.id,
        labelIndex: segment.labelIndex,
        operationIndex: rail.operationIndex,
        subpathIndex: rail.subpathIndex,
        start: { x: segment.start.x * scale.x, y: segment.start.y * scale.y },
        end: { x: segment.end.x * scale.x, y: segment.end.y * scale.y },
      })
    }
  }
  let checks = 2_000_000
  const audits = regions.map((region) => {
    const matches: {
      edgeIndex: number
      chainId: string
      labelIndex: number
      operationIndex: number
      subpathIndex: number
      overlapPx: number
      maxDistancePx: number
    }[] = []
    for (let edgeIndex = 0; edgeIndex < region.polygon.length; edgeIndex++) {
      const a = region.polygon[edgeIndex]
      const b = region.polygon[(edgeIndex + 1) % region.polygon.length]
      if (!a || !b) throw new Error('Incomplete candidate boundary')
      for (const span of spans) {
        if (--checks < 0) throw new Error('Dimension boundary comparison budget exceeded')
        const overlap = annotationOverlap(a, b, span.start, span.end)
        if (overlap)
          matches.push({
            edgeIndex,
            chainId: span.chainId,
            labelIndex: span.labelIndex,
            operationIndex: span.operationIndex,
            subpathIndex: span.subpathIndex,
            ...overlap,
          })
      }
    }
    return {
      regionId: region.id,
      status: matches.length
        ? ('blocked-annotation-boundary' as const)
        : ('needs-source-review' as const),
      annotationBoundaryMatches: matches,
    }
  })
  return {
    status: 'draft' as const,
    source: native.source,
    maxDistancePx: MAX_DISTANCE_PX,
    minOverlapPx: MIN_OVERLAP_PX,
    audits,
  }
}
