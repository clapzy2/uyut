import type { PlanPageContours, PlanPageSegmentRef } from '@uyut/db'
import { planPageContoursSchema, planPageFeaturesIssue } from './plan-page-review'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { nativePageSegments, sourceOpeningEndpoint } from './plan-pdf-opening-endpoint'
import {
  type PdfPlanSource,
  pdfContourIssue,
  pdfContourKey,
  pdfPointInside,
  pdfPolygonIsValid,
} from './plan-pdf-room-binding'

export type PdfWallFaceInterval = {
  /** Physical zone key or exterior, never a guessed room name. */
  contourKey: string
  wallEdgeIndex: number
  start: PagePoint
  end: PagePoint
  nativeSegment: PlanPageSegmentRef
}
export type PdfWallFacePair = { faces: [PdfWallFaceInterval, PdfWallFaceInterval] }

type Face = {
  contourKey: string
  wallEdgeIndex: number
  along: 'x' | 'y'
  across: 'x' | 'y'
  coordinate: number
  freeSide: number
  intervals: Array<[number, number]>
}
type Support = { face: Face; low: number; high: number; ref: PlanPageSegmentRef }
type Candidate = { first: Support; second: Support; low: number; high: number }

const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const faceKey = (face: Face) => `${face.contourKey}:${face.wallEdgeIndex}`
const refKey = (ref: PlanPageSegmentRef) =>
  [ref.operationIndex, ref.subpathIndex, ref.segmentIndex]
    .map((n) => String(n).padStart(6, '0'))
    .join(':')
const areaSign = (points: readonly PagePoint[]) =>
  Math.sign(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return next ? sum + point.x * next.y - next.x * point.y : sum
    }, 0),
  )

function facesFromContours(contours: PlanPageContours): Face[] {
  const zones = [
    ...contours.rooms.map((room) => ({ key: pdfContourKey(room), ...room, exterior: false })),
    ...(contours.exterior
      ? [{ key: 'exterior', ...contours.exterior, exterior: true, openings: [] }]
      : []),
  ]
  return zones.flatMap((zone) =>
    zone.polygon.flatMap((start, wallEdgeIndex) => {
      const end = zone.polygon[(wallEdgeIndex + 1) % zone.polygon.length]
      if (!end || (start.x !== end.x && start.y !== end.y)) return []
      const along = start.y === end.y ? 'x' : 'y'
      const across = along === 'x' ? 'y' : 'x'
      const low = Math.min(start[along], end[along])
      const high = Math.max(start[along], end[along])
      const cuts = (zone.openings ?? [])
        .filter((opening) => opening.wallEdgeIndex === wallEdgeIndex)
        .map((opening): [number, number] => [
          Math.min(opening.start[along], opening.end[along]),
          Math.max(opening.start[along], opening.end[along]),
        ])
        .sort((a, b) => a[0] - b[0])
      const intervals: Array<[number, number]> = []
      let cursor = low
      for (const [begin, finish] of cuts) {
        if (begin > cursor) intervals.push([cursor, begin])
        cursor = Math.max(cursor, finish)
      }
      if (cursor < high) intervals.push([cursor, high])
      return [
        {
          contourKey: zone.key,
          wallEdgeIndex,
          along,
          across,
          coordinate: start[across],
          freeSide:
            areaSign(zone.polygon) *
            Math.sign(end[along] - start[along]) *
            (along === 'x' ? 1 : -1) *
            (zone.exterior ? -1 : 1),
          intervals,
        },
      ]
    }),
  )
}

/** A native boundary through the open strip prevents asserting a solid interval. */
function crossesOpenStrip(a: PagePoint, b: PagePoint, low: PagePoint, high: PagePoint): boolean {
  let begin = 0
  let end = 1
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis]
    if (delta === 0) {
      if (a[axis] <= low[axis] || a[axis] >= high[axis]) return false
    } else {
      const first = (low[axis] - a[axis]) / delta
      const second = (high[axis] - a[axis]) / delta
      begin = Math.max(begin, Math.min(first, second))
      end = Math.min(end, Math.max(first, second))
      if (begin >= end) return false
    }
  }
  const middle = (begin + end) / 2
  const point = { x: a.x + (b.x - a.x) * middle, y: a.y + (b.y - a.y) * middle }
  return point.x > low.x && point.x < high.x && point.y > low.y && point.y < high.y
}

function stripWithinPath(
  path: readonly PagePoint[],
  contours: PlanPageContours,
  first: Support,
  second: Support,
  low: number,
  high: number,
): boolean {
  const { along, across, coordinate } = first.face
  const lower = Math.min(coordinate, second.face.coordinate)
  const upper = Math.max(coordinate, second.face.coordinate)
  const start = { [along]: low, [across]: lower } as PagePoint
  const end = { [along]: high, [across]: upper } as PagePoint
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  if (!pdfPointInside(middle, path)) return false
  // A source outline is not permission to bridge an annotated room's free floor.
  if (
    contours.rooms.some(
      ({ polygon }) =>
        pdfPointInside(middle, polygon) ||
        polygon.some((a, index) => {
          const b = polygon[(index + 1) % polygon.length]
          return b && crossesOpenStrip(a, b, start, end)
        }),
    )
  )
    return false
  return !path.some((a, index) => {
    const b = path[(index + 1) % path.length]
    return b && crossesOpenStrip(a, b, start, end)
  })
}

function pathPoints(path: PdfVectorPath): PagePoint[] | undefined {
  if (!path.closed || path.paint === 'fill' || path.points.length > 100) return
  const first = path.points[0]
  const last = path.points.at(-1)
  if (!first || !last) return
  const points = samePoint(first, last) ? path.points.slice(0, -1) : path.points
  // Reuse the polygon validity contract: holes, crossing outlines or duplicate vertices are not fitted.
  return pdfPolygonIsValid(points) ? points : undefined
}

/** Exact partial face relations within one native closed outline; not complete wall topology. */
export function pairPlanPageWallFaces(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
): PdfWallFacePair[] {
  if (
    source.state !== 'existing' ||
    work.clippedPaths > 0 ||
    work.paths.length > 3000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000 ||
    !planPageContoursSchema.safeParse(contours).success ||
    pdfContourIssue(work, source, contours) ||
    planPageFeaturesIssue(contours, { checkRoomOverlap: true })
  )
    return []
  const native = new Set(work.paths.flatMap((path) => path.points.map((p) => `${p.x}:${p.y}`)))
  const segments = nativePageSegments(work)
  for (const room of contours.rooms) {
    if (room.polygon.some((p) => !native.has(`${p.x}:${p.y}`))) return []
    for (const opening of room.openings ?? []) {
      const a = room.polygon[opening.wallEdgeIndex]
      const b = room.polygon[(opening.wallEdgeIndex + 1) % room.polygon.length]
      if (
        !a ||
        !b ||
        !sourceOpeningEndpoint(
          opening.start,
          opening.endpointProofs?.start,
          [a, b],
          native,
          segments,
        ) ||
        !sourceOpeningEndpoint(opening.end, opening.endpointProofs?.end, [a, b], native, segments)
      )
        return []
    }
  }
  if (contours.exterior?.polygon.some((p) => !native.has(`${p.x}:${p.y}`))) return []
  const faces = facesFromContours(contours)
  if (faces.length > 200) return []
  // Multiple closed subpaths can represent a hole or a compound outline. Their winding
  // relationship is not represented here, so do not treat one outer loop as a solid strip.
  const closedSubpaths = new Map<number, number>()
  for (const path of work.paths) {
    if (path.closed)
      closedSubpaths.set(path.operationIndex, (closedSubpaths.get(path.operationIndex) ?? 0) + 1)
  }
  const candidates: Candidate[] = []
  for (const path of work.paths) {
    if ((closedSubpaths.get(path.operationIndex) ?? 0) > 1) continue
    const points = pathPoints(path)
    if (!points) continue
    const supports: Support[] = []
    const sign = areaSign(points)
    for (const [segmentIndex, a] of points.entries()) {
      const b = points[(segmentIndex + 1) % points.length]
      if (!b || (a.x !== b.x && a.y !== b.y)) continue
      const along = a.y === b.y ? 'x' : 'y'
      const across = along === 'x' ? 'y' : 'x'
      const inside = sign * Math.sign(b[along] - a[along]) * (along === 'x' ? 1 : -1)
      for (const face of faces) {
        if (face.along !== along || face.coordinate !== a[across] || face.freeSide === inside)
          continue
        for (const interval of face.intervals) {
          const low = Math.max(interval[0], Math.min(a[along], b[along]))
          const high = Math.min(interval[1], Math.max(a[along], b[along]))
          if (low < high)
            supports.push({
              face,
              low,
              high,
              ref: {
                operationIndex: path.operationIndex,
                subpathIndex: path.subpathIndex,
                segmentIndex,
              },
            })
        }
      }
    }
    for (const [index, first] of supports.entries()) {
      for (const second of supports.slice(index + 1)) {
        const a = first.face
        const b = second.face
        if (a.contourKey === b.contourKey || a.along !== b.along || a.coordinate === b.coordinate)
          continue
        const direction = Math.sign(b.coordinate - a.coordinate)
        if (a.freeSide === direction || b.freeSide !== direction) continue
        const low = Math.max(first.low, second.low)
        const high = Math.min(first.high, second.high)
        const cuts = [
          ...new Set([
            low,
            high,
            ...points.map((p) => p[a.along]).filter((n) => n > low && n < high),
          ]),
        ].sort((x, y) => x - y)
        if (low >= high) continue
        for (let cut = 1; cut < cuts.length; cut++) {
          const begin = cuts[cut - 1]
          const end = cuts[cut]
          if (
            begin === undefined ||
            end === undefined ||
            !stripWithinPath(points, contours, first, second, begin, end)
          )
            continue
          candidates.push(
            faceKey(a) < faceKey(b)
              ? { first, second, low: begin, high: end }
              : { first: second, second: first, low: begin, high: end },
          )
          if (candidates.length > 2000) return []
        }
      }
    }
  }
  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const key = `${faceKey(candidate.first.face)}|${faceKey(candidate.second.face)}`
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }
  const result: PdfWallFacePair[] = []
  for (const group of groups.values()) {
    const exemplar = group[0]
    if (!exemplar) continue
    const neighbours = candidates.filter((other) =>
      [other.first.face, other.second.face].some(
        (face) =>
          faceKey(face) === faceKey(exemplar.first.face) ||
          faceKey(face) === faceKey(exemplar.second.face),
      ),
    )
    const cuts = [...new Set(neighbours.flatMap((other) => [other.low, other.high]))].sort(
      (a, b) => a - b,
    )
    let previous: PdfWallFacePair | undefined
    for (let index = 1; index < cuts.length; index++) {
      const low = cuts[index - 1]
      const high = cuts[index]
      if (low === undefined || high === undefined) continue
      const witnesses = group
        .filter((candidate) => candidate.low <= low && candidate.high >= high)
        .sort((a, b) =>
          `${refKey(a.first.ref)}|${refKey(a.second.ref)}`.localeCompare(
            `${refKey(b.first.ref)}|${refKey(b.second.ref)}`,
          ),
        )
      const witness = witnesses[0]
      if (
        !witness ||
        neighbours.some(
          (other) =>
            other.low < high &&
            other.high > low &&
            (faceKey(other.first.face) !== faceKey(exemplar.first.face) ||
              faceKey(other.second.face) !== faceKey(exemplar.second.face)),
        )
      )
        continue
      const interval = (support: Support): PdfWallFaceInterval => ({
        contourKey: support.face.contourKey,
        wallEdgeIndex: support.face.wallEdgeIndex,
        start: {
          [support.face.along]: low,
          [support.face.across]: support.face.coordinate,
        } as PagePoint,
        end: {
          [support.face.along]: high,
          [support.face.across]: support.face.coordinate,
        } as PagePoint,
        nativeSegment: support.ref,
      })
      const pair: PdfWallFacePair = { faces: [interval(witness.first), interval(witness.second)] }
      if (
        previous?.faces.every((face, index) => {
          const next = pair.faces[index]
          return (
            next &&
            samePoint(face.end, next.start) &&
            refKey(face.nativeSegment) === refKey(next.nativeSegment)
          )
        })
      ) {
        previous.faces[0].end = pair.faces[0].end
        previous.faces[1].end = pair.faces[1].end
      } else {
        result.push(pair)
        previous = pair
      }
      if (result.length > 2000) return []
    }
  }
  return result
}
