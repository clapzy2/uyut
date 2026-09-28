import type { PlanPageContours, PlanPageSegmentRef } from '@uyut/db'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { pdfContourKey, pdfPolygonIsValid } from './plan-pdf-room-binding'

export type PdfWallBodySupport = {
  source: { operationIndex: number; subpathIndex: number }
  nativeSegment: PlanPageSegmentRef
  contourKey: string
  wallEdgeIndex: number
  start: PagePoint
  end: PagePoint
  strokeSegment: PlanPageSegmentRef
}

const same = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const cross = (a: PagePoint, b: PagePoint, c: PagePoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const winding = (polygon: PagePoint[]) =>
  Math.sign(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point.x * next.y - next.x * point.y : sum
    }, 0),
  )
const compareRef = (a: PlanPageSegmentRef, b: PlanPageSegmentRef) =>
  a.operationIndex - b.operationIndex ||
  a.subpathIndex - b.subpathIndex ||
  a.segmentIndex - b.segmentIndex

/** Endpoints are selected from native/reviewed edges, never snapped or interpolated. */
function contact(a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint) {
  if (same(a, b) || same(c, d) || cross(a, b, c) !== 0 || cross(a, b, d) !== 0) return
  const axis: 'x' | 'y' = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y'
  const [aLow, aHigh] = a[axis] < b[axis] ? [a, b] : [b, a]
  const [bLow, bHigh] = c[axis] < d[axis] ? [c, d] : [d, c]
  const start = aLow[axis] > bLow[axis] ? aLow : bLow
  const end = aHigh[axis] < bHigh[axis] ? aHigh : bHigh
  return start[axis] < end[axis] ? { start, end, axis } : undefined
}

/**
 * One-sided, independently stroked fill evidence, not a certified wall or void model.
 * Caller validates source identity/native reviewed contours and rejects whole-body conflicts.
 */
export function findPlanPageWallBodySupports(
  work: PdfLinework,
  contours: PlanPageContours,
): PdfWallBodySupport[] {
  if (
    work.truncated ||
    work.clippedPaths > 0 ||
    work.paths.length > 3000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000 ||
    contours.rooms.length > 100 ||
    contours.rooms.reduce((sum, room) => sum + room.polygon.length, 0) > 2000 ||
    contours.rooms.reduce((sum, room) => sum + (room.openings?.length ?? 0), 0) > 200
  )
    return []

  const closedCount = new Map<number, number>()
  const strokes: Array<{ start: PagePoint; end: PagePoint; ref: PlanPageSegmentRef }> = []
  for (const path of work.paths) {
    if (path.closed)
      closedCount.set(path.operationIndex, (closedCount.get(path.operationIndex) ?? 0) + 1)
    if (path.paint === 'fill') continue
    const count = path.closed ? path.points.length : path.points.length - 1
    for (let segmentIndex = 0; segmentIndex < count; segmentIndex++) {
      const start = path.points[segmentIndex]
      const end = path.points[(segmentIndex + 1) % path.points.length]
      if (!start || !end || same(start, end)) continue
      strokes.push({
        start,
        end,
        ref: { operationIndex: path.operationIndex, subpathIndex: path.subpathIndex, segmentIndex },
      })
    }
  }
  strokes.sort((a, b) => compareRef(a.ref, b.ref))
  const result: PdfWallBodySupport[] = []
  let comparisons = 0
  for (const path of work.paths) {
    if (
      path.paint !== 'fill' ||
      !path.closed ||
      path.points.length > 100 ||
      closedCount.get(path.operationIndex) !== 1
    )
      continue
    const first = path.points[0]
    const last = path.points.at(-1)
    if (!first || !last) continue
    const polygon = same(first, last) ? path.points.slice(0, -1) : path.points
    if (!pdfPolygonIsValid(polygon)) continue
    const bodyWinding = winding(polygon)
    for (const room of contours.rooms) {
      if (!pdfPolygonIsValid(room.polygon)) continue
      const roomWinding = winding(room.polygon)
      for (const [wallEdgeIndex, a] of room.polygon.entries()) {
        const b = room.polygon[(wallEdgeIndex + 1) % room.polygon.length]
        if (!b || room.conditionalEdges?.some((edge) => edge.wallEdgeIndex === wallEdgeIndex))
          continue
        for (const [segmentIndex, c] of polygon.entries()) {
          if (++comparisons > 1_000_000) return []
          const d = polygon[(segmentIndex + 1) % polygon.length]
          const overlap = d && contact(a, b, c, d)
          if (!d || !overlap) continue
          const { axis } = overlap
          // Polygon interiors must lie on opposite sides of this shared boundary.
          if (
            roomWinding * Math.sign(b[axis] - a[axis]) ===
            bodyWinding * Math.sign(d[axis] - c[axis])
          )
            continue
          let intervals = [{ start: overlap.start, end: overlap.end }]
          for (const opening of room.openings ?? []) {
            if (opening.wallEdgeIndex !== wallEdgeIndex) continue
            const cut = contact(a, b, opening.start, opening.end)
            if (!cut) continue
            intervals = intervals.flatMap((interval) => {
              if (cut.end[axis] <= interval.start[axis] || cut.start[axis] >= interval.end[axis])
                return [interval]
              const remaining: Array<{ start: PagePoint; end: PagePoint }> = []
              if (cut.start[axis] > interval.start[axis])
                remaining.push({ start: interval.start, end: cut.start })
              if (cut.end[axis] < interval.end[axis])
                remaining.push({ start: cut.end, end: interval.end })
              return remaining
            })
          }
          for (const interval of intervals) {
            let stroke: (typeof strokes)[number] | undefined
            for (const candidate of strokes) {
              if (++comparisons > 1_000_000) return []
              if (candidate.ref.operationIndex === path.operationIndex) continue
              const covered = contact(interval.start, interval.end, candidate.start, candidate.end)
              if (
                covered &&
                same(covered.start, interval.start) &&
                same(covered.end, interval.end)
              ) {
                stroke = candidate
                break
              }
            }
            if (!stroke) continue
            result.push({
              source: { operationIndex: path.operationIndex, subpathIndex: path.subpathIndex },
              nativeSegment: {
                operationIndex: path.operationIndex,
                subpathIndex: path.subpathIndex,
                segmentIndex,
              },
              contourKey: pdfContourKey(room),
              wallEdgeIndex,
              start: { ...interval.start },
              end: { ...interval.end },
              strokeSegment: { ...stroke.ref },
            })
          }
        }
      }
    }
  }
  return result.sort(
    (a, b) =>
      compareRef(a.nativeSegment, b.nativeSegment) ||
      a.contourKey.localeCompare(b.contourKey) ||
      a.wallEdgeIndex - b.wallEdgeIndex ||
      a.start.x - b.start.x ||
      a.start.y - b.start.y,
  )
}
