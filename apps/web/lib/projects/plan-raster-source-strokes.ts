import type { PagePoint } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import type { RasterRegionGuide, RasterSourceStrokeGuide } from './plan-raster-snap'
import { rasterRegionStraightEdges } from './plan-raster-snap'
import { sourceEdgeCandidates } from './plan-source-edge-candidates'

type PixelPoint = { x: number; y: number }

/** Source stroke proximity on the selected raster edge, never physical floor proof. */
export function rasterSourceStrokeGuide(
  region: RasterRegionGuide,
  image: { width: number; height: number },
  page: { width: number; height: number },
  segments: readonly NativePageSegment[],
): RasterSourceStrokeGuide | undefined {
  if (
    ![image.width, image.height, page.width, page.height].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    segments.length > 20_000
  )
    return undefined

  const edges = rasterRegionStraightEdges(region, image.width, image.height)
  if (edges.length === 0 || edges.length > 40) return undefined
  const normalized = (point: PixelPoint): PagePoint => ({
    x: (point.x * 1000) / image.width,
    y: (point.y * 1000) / image.height,
  })
  const pixel = (point: PagePoint): PixelPoint => ({
    x: (point.x * image.width) / 1000,
    y: (point.y * image.height) / 1000,
  })

  return {
    regionId: region.id,
    edges: edges.map((edge, index) => {
      const result = sourceEdgeCandidates(
        [normalized(edge.start), normalized(edge.end)],
        segments,
        page,
      )
      if (result.status === 'held') return { index, status: 'held' as const, strokes: [] }

      const dx = edge.end.x - edge.start.x
      const dy = edge.end.y - edge.start.y
      const lengthSquared = dx * dx + dy * dy
      const strokes = result.candidates.flatMap(({ segment }) => {
        const a = pixel(segment.start)
        const b = pixel(segment.end)
        const position = (point: PixelPoint) =>
          Math.max(
            0,
            Math.min(
              1,
              ((point.x - edge.start.x) * dx + (point.y - edge.start.y) * dy) / lengthSquared,
            ),
          )
        const first = position(a)
        const last = position(b)
        if (Math.abs(last - first) * Math.sqrt(lengthSquared) < 3) return []
        return [
          {
            operationIndex: segment.operationIndex,
            subpathIndex: segment.subpathIndex,
            segmentIndex: segment.segmentIndex,
            start: { x: edge.start.x + first * dx, y: edge.start.y + first * dy },
            end: { x: edge.start.x + last * dx, y: edge.start.y + last * dy },
          },
        ]
      })
      return { index, status: strokes.length ? ('nearby' as const) : ('none' as const), strokes }
    }),
  }
}
