import type { PlanPageContours } from '@uyut/db'
import { polygonsOverlap, polygonWithin, segmentEntersPolygon } from './plan-page-review'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pairPlanPageWallFaces } from './plan-pdf-wall-faces'

type SourcePath = { operationIndex: number; subpathIndex: number }
export type PdfWallSolidCandidate = {
  source: SourcePath
  polygon: PagePoint[]
  status: 'candidate' | 'conflict'
  reasons: Array<'room-floor' | 'opening' | 'outside-exterior' | 'overlapping-solid'>
}
export type PdfWallJunction = {
  first: SourcePath
  second: SourcePath
  start: PagePoint
  end: PagePoint
}
const key = (path: SourcePath) => `${path.operationIndex}:${path.subpathIndex}`
const same = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const cross = (a: PagePoint, b: PagePoint, c: PagePoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Exact positive-length contact, including mitred edges; a nearby line is not a joint. */
function sharedEdge(a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint) {
  if (same(a, b) || same(c, d) || cross(a, b, c) !== 0 || cross(a, b, d) !== 0) return
  const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y'
  const firstLow = a[axis] < b[axis] ? a : b
  const firstHigh = a[axis] < b[axis] ? b : a
  const secondLow = c[axis] < d[axis] ? c : d
  const secondHigh = c[axis] < d[axis] ? d : c
  const start = firstLow[axis] > secondLow[axis] ? firstLow : secondLow
  const end = firstHigh[axis] < secondHigh[axis] ? firstHigh : secondHigh
  return start[axis] < end[axis] ? { start: { ...start }, end: { ...end } } : undefined
}

/** Diagnostic native solids only. Never unions polygons or certifies complete wall topology.
 * Candidates are seeded by independently checked face pairs, not arbitrary page fills.
 * Unannotated voids and unseeded wall pieces remain unresolved.
 */
export function inspectPlanPageWallSolids(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
) {
  const pairs = pairPlanPageWallFaces(work, source, contours)
  const seeds = new Set(
    pairs.flatMap(({ faces }) => faces.map(({ nativeSegment }) => key(nativeSegment))),
  )
  // Whole-polygon pair checks are quadratic; keep this diagnostic bounded.
  if (seeds.size > 128) return { solids: [], junctions: [], issue: 'solid-audit-limit' as const }
  const solids: PdfWallSolidCandidate[] = []
  for (const path of work.paths) {
    if (!seeds.has(key(path))) continue
    const first = path.points[0]
    const last = path.points.at(-1)
    if (!first || !last) continue
    const polygon = (same(first, last) ? path.points.slice(0, -1) : path.points).map((p) => ({
      ...p,
    }))
    const reasons: PdfWallSolidCandidate['reasons'] = []
    if (contours.rooms.some((room) => polygonsOverlap(polygon, room.polygon)))
      reasons.push('room-floor')
    if (
      contours.rooms.some((room) =>
        room.openings?.some(
          (opening) =>
            segmentEntersPolygon(opening.start, opening.end, polygon) ||
            polygon.some((a, index) => {
              const b = polygon[(index + 1) % polygon.length]
              return b && sharedEdge(opening.start, opening.end, a, b)
            }),
        ),
      )
    )
      reasons.push('opening')
    if (contours.exterior && !polygonWithin(polygon, contours.exterior.polygon))
      reasons.push('outside-exterior')
    solids.push({
      source: { operationIndex: path.operationIndex, subpathIndex: path.subpathIndex },
      polygon,
      status: reasons.length ? 'conflict' : 'candidate',
      reasons,
    })
  }
  const junctions: PdfWallJunction[] = []
  for (let i = 0; i < solids.length; i++) {
    const first = solids[i]
    if (!first) continue
    for (const second of solids.slice(i + 1)) {
      if (polygonsOverlap(first.polygon, second.polygon)) {
        for (const solid of [first, second]) {
          solid.status = 'conflict'
          if (!solid.reasons.includes('overlapping-solid')) solid.reasons.push('overlapping-solid')
        }
        continue
      }
      for (const [index, a] of first.polygon.entries()) {
        const b = first.polygon[(index + 1) % first.polygon.length]
        if (!b) continue
        for (const [otherIndex, c] of second.polygon.entries()) {
          const d = second.polygon[(otherIndex + 1) % second.polygon.length]
          const contact = d && sharedEdge(a, b, c, d)
          if (contact) junctions.push({ first: first.source, second: second.source, ...contact })
        }
      }
    }
  }
  const conflicts = new Set(
    solids.filter((solid) => solid.status === 'conflict').map((solid) => key(solid.source)),
  )
  return {
    solids,
    junctions: junctions.filter(
      (joint) => !conflicts.has(key(joint.first)) && !conflicts.has(key(joint.second)),
    ),
  }
}
