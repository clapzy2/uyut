import type { PlanPageContours } from '@uyut/db'
import { difference, intersection, type MultiPolygon, type Polygon, union } from 'polygon-clipping'
import { segmentEntersPolygon } from './plan-page-review'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfPaintedBoundarySupport } from './plan-pdf-painted-boundary'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pdfContourKey, pdfPolygonIsValid } from './plan-pdf-room-binding'
import { validPlanPageWallSource } from './plan-pdf-wall-faces'

type SourcePath = { operationIndex: number; subpathIndex: number }

export type PdfPaintedWallAudit = {
  reviewedFillColor: string
  body: MultiPolygon
  acceptedSources: SourcePath[]
  degenerateSources: SourcePath[]
  outsideSources: SourcePath[]
  crossingSources: SourcePath[]
  roomFloorConflicts: Array<{
    contourKey: string
    overlap: MultiPolygon
    areaPageSquared: number
  }>
  openingPenetrations: Array<{
    contourKey: string
    openingId: string
    kind: 'door' | 'window' | 'balcony'
    paintedSources: SourcePath[]
  }>
  reviewedRegionOverlaps: Array<{
    id: string
    kind: 'shaft' | 'column' | 'fixed' | 'void'
    overlap: MultiPolygon
    areaPageSquared: number
  }>
}

export type ReviewedPaintRegion = {
  id: string
  kind: 'shaft' | 'column' | 'fixed' | 'void'
  polygon: PagePoint[]
}

const sourceOf = (path: PdfVectorPath): SourcePath => ({
  operationIndex: path.operationIndex,
  subpathIndex: path.subpathIndex,
})

const polygonOf = (path: PdfVectorPath): Polygon => [path.points.map((point) => [point.x, point.y])]

function ringArea(ring: number[][]): number {
  return Math.abs(
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length]
      if (!next) return sum
      const [x = 0, y = 0] = point
      const [nextX = 0, nextY = 0] = next
      return sum + x * nextY - nextX * y
    }, 0) / 2,
  )
}

function multiPolygonArea(polygons: MultiPolygon): number {
  return polygons.reduce(
    (total, polygon) =>
      total +
      polygon.reduce((area, ring, index) => area + (index === 0 ? 1 : -1) * ringArea(ring), 0),
    0,
  )
}

/** The triangle edge must remain on the union perimeter, not become an internal seam. */
export function supportsOnPaintedBodyBoundary(
  body: MultiPolygon,
  supports: readonly PdfPaintedBoundarySupport[],
): PdfPaintedBoundarySupport[] {
  const boundaryEdges = body.flatMap((polygon) =>
    polygon.flatMap((ring) =>
      ring.slice(0, -1).flatMap((start, index) => {
        const end = ring[index + 1]
        return end ? [{ start, end }] : []
      }),
    ),
  )
  return supports.filter((support) => {
    const axis =
      Math.abs(support.end.x - support.start.x) >= Math.abs(support.end.y - support.start.y) ? 0 : 1
    const low = Math.min(support.start.x, support.end.x)
    const high = Math.max(support.start.x, support.end.x)
    const startCoordinate = axis === 0 ? low : Math.min(support.start.y, support.end.y)
    const endCoordinate = axis === 0 ? high : Math.max(support.start.y, support.end.y)
    const cross = (point: number[]) =>
      (support.end.x - support.start.x) * ((point[1] ?? 0) - support.start.y) -
      (support.end.y - support.start.y) * ((point[0] ?? 0) - support.start.x)
    const intervals = boundaryEdges.flatMap(({ start, end }) => {
      if (cross(start) !== 0 || cross(end) !== 0) return []
      const startValue = start[axis]
      const endValue = end[axis]
      if (startValue === undefined || endValue === undefined) return []
      const begin = Math.max(startCoordinate, Math.min(startValue, endValue))
      const finish = Math.min(endCoordinate, Math.max(startValue, endValue))
      return begin < finish ? [[begin, finish] as const] : []
    })
    intervals.sort((a, b) => a[0] - b[0])
    let coveredUntil = startCoordinate
    for (const [begin, finish] of intervals) {
      if (begin > coveredUntil) break
      coveredUntil = Math.max(coveredUntil, finish)
      if (coveredUntil >= endCoordinate) return true
    }
    return false
  })
}

/** Source triangles only. Boolean union does not repair input gaps or certify construction walls. */
export function inspectPlanPagePaintedWallSolids(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
  reviewedFillColor: string,
  reviewedRegions: readonly ReviewedPaintRegion[] = [],
): PdfPaintedWallAudit | undefined {
  if (
    !contours.exterior ||
    !/^#[0-9a-f]{6}$/i.test(reviewedFillColor) ||
    !validPlanPageWallSource(work, source, contours)
  )
    return undefined

  const exterior: Polygon = [contours.exterior.polygon.map((point) => [point.x, point.y])]
  const nativePoints = new Set(
    work.paths.flatMap((path) => path.points.map((point) => `${point.x}:${point.y}`)),
  )
  if (
    reviewedRegions.some((region) => {
      const polygon: Polygon = [region.polygon.map((point) => [point.x, point.y])]
      return (
        !pdfPolygonIsValid(region.polygon) ||
        region.polygon.some((point) => !nativePoints.has(`${point.x}:${point.y}`)) ||
        difference(polygon, exterior).length > 0
      )
    })
  )
    return undefined
  const accepted: Polygon[] = []
  const acceptedSources: SourcePath[] = []
  const degenerateSources: SourcePath[] = []
  const outsideSources: SourcePath[] = []
  const crossingSources: SourcePath[] = []
  const color = reviewedFillColor.toLowerCase()
  for (const path of work.paths) {
    if (
      path.paint !== 'fill-stroke' ||
      path.fillColor !== color ||
      !path.closed ||
      path.points.length !== 3
    )
      continue
    const polygon = polygonOf(path)
    if (ringArea(polygon[0] ?? []) === 0) {
      degenerateSources.push(sourceOf(path))
      continue
    }
    if (intersection(polygon, exterior).length === 0) {
      outsideSources.push(sourceOf(path))
      continue
    }
    if (difference(polygon, exterior).length > 0) {
      crossingSources.push(sourceOf(path))
      continue
    }
    accepted.push(polygon)
    acceptedSources.push(sourceOf(path))
  }
  if (
    accepted.length > 500 ||
    reviewedRegions.length > 100 ||
    acceptedSources.length +
      degenerateSources.length +
      outsideSources.length +
      crossingSources.length ===
      0
  )
    return undefined
  const first = accepted[0]
  const second = accepted[1]
  const body = !first ? [] : !second ? [first] : union(first, second, ...accepted.slice(2))
  const roomFloorConflicts = contours.rooms.flatMap((room) => {
    if (body.length === 0) return []
    const floor: Polygon = [room.polygon.map((point) => [point.x, point.y])]
    const overlap = intersection(body, floor)
    const areaPageSquared = multiPolygonArea(overlap)
    return areaPageSquared > 0
      ? [{ contourKey: pdfContourKey(room), overlap, areaPageSquared }]
      : []
  })
  const openingPenetrations = contours.rooms.flatMap((room) =>
    (room.openings ?? []).flatMap((opening) => {
      const paintedSources = accepted.flatMap((polygon, index) => {
        const source = acceptedSources[index]
        return source &&
          segmentEntersPolygon(
            opening.start,
            opening.end,
            polygon[0]?.map(([x, y]) => ({ x, y })) ?? [],
          )
          ? [source]
          : []
      })
      return paintedSources.length > 0
        ? [
            {
              contourKey: pdfContourKey(room),
              openingId: opening.id,
              kind: opening.kind,
              paintedSources,
            },
          ]
        : []
    }),
  )
  const regions: ReviewedPaintRegion[] = [
    ...reviewedRegions,
    ...(contours.voids ?? []).map((area) => ({ ...area, kind: 'void' as const })),
    ...contours.rooms.flatMap((room) => room.obstacles ?? []),
  ]
  const reviewedRegionOverlaps = regions.flatMap((region) => {
    if (body.length === 0) return []
    const polygon: Polygon = [region.polygon.map((point) => [point.x, point.y])]
    const overlap = intersection(body, polygon)
    const areaPageSquared = multiPolygonArea(overlap)
    return areaPageSquared > 0
      ? [{ id: region.id, kind: region.kind, overlap, areaPageSquared }]
      : []
  })
  return {
    reviewedFillColor: color,
    body,
    acceptedSources,
    degenerateSources,
    outsideSources,
    crossingSources,
    roomFloorConflicts,
    openingPenetrations,
    reviewedRegionOverlaps,
  }
}
