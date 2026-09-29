import type { PlanPageContours, PlanPageSegmentRef } from '@uyut/db'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pdfContourKey } from './plan-pdf-room-binding'
import type { PdfWallCoverageSpan } from './plan-pdf-wall-coverage'
import { validPlanPageWallSource } from './plan-pdf-wall-faces'

export type PdfPaintedBoundarySupport = {
  contourKey: string
  wallEdgeIndex: number
  start: PagePoint
  end: PagePoint
  sourceSegments: PlanPageSegmentRef[]
}

const cross = (a: PagePoint, b: PagePoint, c: PagePoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

function winding(polygon: PagePoint[]): number {
  return Math.sign(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point.x * next.y - next.x * point.y : sum
    }, 0),
  )
}

function intervalOnEdge(
  edgeStart: PagePoint,
  edgeEnd: PagePoint,
  start: PagePoint,
  end: PagePoint,
  axis: 'x' | 'y',
): [number, number] | undefined {
  if (cross(edgeStart, edgeEnd, start) !== 0 || cross(edgeStart, edgeEnd, end) !== 0)
    return undefined
  const low = Math.min(start[axis], end[axis])
  const high = Math.max(start[axis], end[axis])
  if (
    low >= high ||
    low < Math.min(edgeStart[axis], edgeEnd[axis]) ||
    high > Math.max(edgeStart[axis], edgeEnd[axis])
  )
    return undefined
  return [low, high]
}

function triangleEdges(paths: PdfVectorPath[], color: string) {
  return paths.flatMap((path) => {
    if (
      path.paint !== 'fill-stroke' ||
      path.fillColor !== color ||
      !path.closed ||
      path.points.length !== 3
    )
      return []
    const [a, b, c] = path.points
    if (!a || !b || !c || cross(a, b, c) === 0) return []
    return [
      { start: a, end: b, inside: c, path, segmentIndex: 0 },
      { start: b, end: c, inside: a, path, segmentIndex: 1 },
      { start: c, end: a, inside: b, path, segmentIndex: 2 },
    ]
  })
}

/** Exact local paint evidence only; it neither unions triangles nor certifies wall topology. */
export function findPlanPagePaintedBoundarySpans(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
  spans: readonly PdfWallCoverageSpan[],
  reviewedFillColor: string,
): PdfPaintedBoundarySupport[] {
  if (
    !/^#[0-9a-f]{6}$/i.test(reviewedFillColor) ||
    !validPlanPageWallSource(work, source, contours) ||
    spans.length > 500
  )
    return []
  const edges = triangleEdges(work.paths, reviewedFillColor.toLowerCase())
  const polygons = new Map(
    contours.rooms.map((room) => [pdfContourKey(room), room.polygon] as const),
  )
  if (contours.exterior) polygons.set('exterior', contours.exterior.polygon)
  const result: PdfPaintedBoundarySupport[] = []
  let comparisons = 0
  for (const span of spans) {
    if (!['unmatched', 'unpaired-exterior', 'unsupported-angle'].includes(span.status)) continue
    const polygon = polygons.get(span.contourKey)
    const edgeStart = polygon?.[span.wallEdgeIndex]
    const edgeEnd = polygon?.[(span.wallEdgeIndex + 1) % polygon.length]
    if (!polygon || !edgeStart || !edgeEnd) continue
    const axis = Math.abs(edgeEnd.x - edgeStart.x) >= Math.abs(edgeEnd.y - edgeStart.y) ? 'x' : 'y'
    const target = intervalOnEdge(edgeStart, edgeEnd, span.start, span.end, axis)
    if (!target) continue
    const side = winding(polygon) * (span.contourKey === 'exterior' ? 1 : -1)
    if (side === 0) continue
    const contacts: Array<{ interval: [number, number]; ref: PlanPageSegmentRef }> = []
    for (const candidate of edges) {
      if (++comparisons > 1_000_000) return []
      if (Math.sign(cross(edgeStart, edgeEnd, candidate.inside)) !== side) continue
      const sourceInterval = intervalOnEdge(
        edgeStart,
        edgeEnd,
        candidate.start,
        candidate.end,
        axis,
      )
      if (!sourceInterval) continue
      const low = Math.max(target[0], sourceInterval[0])
      const high = Math.min(target[1], sourceInterval[1])
      if (low >= high) continue
      contacts.push({
        interval: [low, high],
        ref: {
          operationIndex: candidate.path.operationIndex,
          subpathIndex: candidate.path.subpathIndex,
          segmentIndex: candidate.segmentIndex,
        },
      })
    }
    contacts.sort((a, b) => a.interval[0] - b.interval[0] || b.interval[1] - a.interval[1])
    let coveredUntil = target[0]
    const sourceSegments: PlanPageSegmentRef[] = []
    for (const contact of contacts) {
      if (contact.interval[0] > coveredUntil) break
      if (contact.interval[1] <= coveredUntil) continue
      coveredUntil = contact.interval[1]
      sourceSegments.push(contact.ref)
      if (coveredUntil >= target[1]) break
    }
    if (coveredUntil < target[1]) continue
    result.push({
      contourKey: span.contourKey,
      wallEdgeIndex: span.wallEdgeIndex,
      start: { ...span.start },
      end: { ...span.end },
      sourceSegments,
    })
  }
  return result
}
