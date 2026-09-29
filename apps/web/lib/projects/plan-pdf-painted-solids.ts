import type { PlanPageContours } from '@uyut/db'
import { difference, intersection, type MultiPolygon, type Polygon, union } from 'polygon-clipping'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pdfContourKey } from './plan-pdf-room-binding'
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

/** Source triangles only. Boolean union does not repair input gaps or certify construction walls. */
export function inspectPlanPagePaintedWallSolids(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
  reviewedFillColor: string,
): PdfPaintedWallAudit | undefined {
  if (
    !contours.exterior ||
    !/^#[0-9a-f]{6}$/i.test(reviewedFillColor) ||
    !validPlanPageWallSource(work, source, contours)
  )
    return undefined

  const exterior: Polygon = [contours.exterior.polygon.map((point) => [point.x, point.y])]
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
  if (accepted.length > 500) return undefined
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
  return {
    reviewedFillColor: color,
    body,
    acceptedSources,
    degenerateSources,
    outsideSources,
    crossingSources,
    roomFloorConflicts,
  }
}
