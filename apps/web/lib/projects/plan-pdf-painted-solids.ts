import type { PlanPageContours } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { segmentEntersPolygon } from './plan-page-review'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfPaintedBoundarySupport } from './plan-pdf-painted-boundary'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pdfContourKey, pdfPolygonIsValid } from './plan-pdf-room-binding'
import type { PdfWallCoverageSpan } from './plan-pdf-wall-coverage'
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

export type PaintedBodyBoundaryAssessment = {
  span: PdfWallCoverageSpan
  status: 'supported' | 'opposite-side' | 'no-boundary'
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

function signedArea(points: readonly (readonly number[])[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return next ? sum + (point[0] ?? 0) * (next[1] ?? 0) - (next[0] ?? 0) * (point[1] ?? 0) : sum
  }, 0)
}

function spanIsCovered(intervals: Array<[number, number]>, low: number, high: number): boolean {
  intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  let coveredUntil = low
  for (const [begin, finish] of intervals) {
    if (begin > coveredUntil) break
    coveredUntil = Math.max(coveredUntil, finish)
    if (coveredUntil >= high) return true
  }
  return false
}

/** Exact union-perimeter evidence, with paint required on the wall side of the contour.
 * This supplements local triangle-edge evidence but does not certify a complete wall.
 */
export function inspectPaintedBodyBoundarySpans(
  body: MultiPolygon,
  contours: PlanPageContours,
  spans: readonly PdfWallCoverageSpan[],
): PaintedBodyBoundaryAssessment[] {
  const zones = new Map(contours.rooms.map((room) => [pdfContourKey(room), room.polygon] as const))
  if (contours.exterior) zones.set('exterior', contours.exterior.polygon)
  return spans.map((span) => {
    const zone = zones.get(span.contourKey)
    const edgeStart = zone?.[span.wallEdgeIndex]
    const edgeEnd = zone?.[(span.wallEdgeIndex + 1) % zone.length]
    const fallback = { span, status: 'no-boundary' as const }
    if (!zone || !edgeStart || !edgeEnd) return fallback
    const turn = (point: PagePoint) =>
      (span.end.x - span.start.x) * (point.y - span.start.y) -
      (span.end.y - span.start.y) * (point.x - span.start.x)
    if (turn(edgeStart) !== 0 || turn(edgeEnd) !== 0) return fallback
    const axis = Math.abs(span.end.x - span.start.x) >= Math.abs(span.end.y - span.start.y) ? 0 : 1
    const low = Math.min(
      axis === 0 ? span.start.x : span.start.y,
      axis === 0 ? span.end.x : span.end.y,
    )
    const high = Math.max(
      axis === 0 ? span.start.x : span.start.y,
      axis === 0 ? span.end.x : span.end.y,
    )
    const edgeLow = Math.min(
      axis === 0 ? edgeStart.x : edgeStart.y,
      axis === 0 ? edgeEnd.x : edgeEnd.y,
    )
    const edgeHigh = Math.max(
      axis === 0 ? edgeStart.x : edgeStart.y,
      axis === 0 ? edgeEnd.x : edgeEnd.y,
    )
    if (low >= high || low < edgeLow || high > edgeHigh) return fallback
    const zoneSign = Math.sign(signedArea(zone.map((point) => [point.x, point.y])))
    const expectedSide = zoneSign * (span.contourKey === 'exterior' ? 1 : -1)
    if (expectedSide === 0) return fallback
    const supported: Array<[number, number]> = []
    const opposite: Array<[number, number]> = []
    for (const polygon of body) {
      const exteriorRing = polygon[0]
      if (!exteriorRing) continue
      const bodySign = Math.sign(signedArea(exteriorRing))
      if (bodySign === 0) continue
      for (const ring of polygon) {
        for (let index = 0; index < ring.length - 1; index++) {
          const start = ring[index]
          const end = ring[index + 1]
          if (!start || !end) continue
          if (
            turn({ x: start[0] ?? 0, y: start[1] ?? 0 }) !== 0 ||
            turn({ x: end[0] ?? 0, y: end[1] ?? 0 }) !== 0
          )
            continue
          const begin = Math.max(low, Math.min(start[axis] ?? 0, end[axis] ?? 0))
          const finish = Math.min(high, Math.max(start[axis] ?? 0, end[axis] ?? 0))
          if (begin >= finish) continue
          const alignment = Math.sign(
            (span.end.x - span.start.x) * ((end[0] ?? 0) - (start[0] ?? 0)) +
              (span.end.y - span.start.y) * ((end[1] ?? 0) - (start[1] ?? 0)),
          )
          if (bodySign * alignment === expectedSide) supported.push([begin, finish])
          else opposite.push([begin, finish])
        }
      }
    }
    return {
      span,
      status: spanIsCovered(supported, low, high)
        ? 'supported'
        : spanIsCovered(opposite, low, high)
          ? 'opposite-side'
          : 'no-boundary',
    }
  })
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
        polygonClipping.difference(polygon, exterior).length > 0
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
    if (polygonClipping.intersection(polygon, exterior).length === 0) {
      outsideSources.push(sourceOf(path))
      continue
    }
    if (polygonClipping.difference(polygon, exterior).length > 0) {
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
  const body = !first
    ? []
    : !second
      ? [first]
      : polygonClipping.union(first, second, ...accepted.slice(2))
  const roomFloorConflicts = contours.rooms.flatMap((room) => {
    if (body.length === 0) return []
    const floor: Polygon = [room.polygon.map((point) => [point.x, point.y])]
    const overlap = polygonClipping.intersection(body, floor)
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
    const overlap = polygonClipping.intersection(body, polygon)
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
