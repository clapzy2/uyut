import type { PlanPageContours, PlanPageOpening, PlanPageRoomIdentity } from '@uyut/db'
import { planPageFeaturesIssue } from './plan-page-review'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  pdfContourIdentity,
  pdfContourIssue,
  pdfContourKey,
} from './plan-pdf-room-binding'

export type PdfOpeningFaceReference = PlanPageRoomIdentity & { openingId: string }
export type PdfOpeningJamb = {
  operationIndex: number
  subpathIndex: number
  segmentIndex: number
  start: PagePoint
  end: PagePoint
}
export type PdfOpeningFaceCheck = PdfOpeningFaceReference &
  (
    | {
        status: 'candidate'
        opposite: PdfOpeningFaceReference
        jambs: [PdfOpeningJamb, PdfOpeningJamb]
      }
    | { status: 'unresolved' | 'ambiguous'; reason: string }
  )
export type PdfOpeningFacePair = {
  openings: [PdfOpeningFaceReference, PdfOpeningFaceReference]
  jambs: [PdfOpeningJamb, PdfOpeningJamb]
}

type Face = {
  reference: PdfOpeningFaceReference
  roomKey: string
  along: 'x' | 'y'
  across: 'x' | 'y'
  low: PagePoint
  high: PagePoint
  interiorSide: number
}

const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const segmentKey = (a: PagePoint, b: PagePoint) =>
  a.x < b.x || (a.x === b.x && a.y < b.y)
    ? JSON.stringify([a.x, a.y, b.x, b.y])
    : JSON.stringify([b.x, b.y, a.x, a.y])

function openingFace(
  room: PlanPageContours['rooms'][number],
  opening: PlanPageOpening,
): Face | undefined {
  const start = room.polygon[opening.wallEdgeIndex]
  const end = room.polygon[(opening.wallEdgeIndex + 1) % room.polygon.length]
  if (!start || !end || (start.x !== end.x && start.y !== end.y)) return undefined
  const along = start.y === end.y ? 'x' : 'y'
  const across = along === 'x' ? 'y' : 'x'
  // This verifier deliberately accepts exact native endpoints only; no snapping or fitting.
  if (opening.start[across] !== start[across] || opening.end[across] !== start[across])
    return undefined
  let twiceArea = 0
  for (const [index, point] of room.polygon.entries()) {
    const next = room.polygon[(index + 1) % room.polygon.length]
    if (next) twiceArea += point.x * next.y - next.x * point.y
  }
  const interiorSide =
    Math.sign(twiceArea) * Math.sign(end[along] - start[along]) * (along === 'x' ? 1 : -1)
  const [low, high] =
    opening.start[along] < opening.end[along]
      ? [opening.start, opening.end]
      : [opening.end, opening.start]
  return {
    reference: { ...pdfContourIdentity(room), openingId: opening.id },
    roomKey: pdfContourKey(room),
    along,
    across,
    low,
    high,
    interiorSide,
  }
}

/** Candidate pairs from declared door faces and two exact native jamb segments.
 * This does not certify a physical wall, width, door leaf, or connectivity of a metric draft.
 */
export function verifyPlanPageOpeningFaces(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
): PdfOpeningFaceCheck[] {
  // Bound the source and annotation work before geometric validation or pair enumeration.
  if (
    work.paths.length > 3000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000 ||
    contours.rooms.length > 100 ||
    contours.rooms.reduce(
      (sum, room) => sum + (room.openings?.length ?? 0) + (room.obstacles?.length ?? 0),
      0,
    ) > 200 ||
    contours.rooms.reduce(
      (sum, room) =>
        sum +
        room.polygon.length +
        (room.obstacles ?? []).reduce((count, obstacle) => count + obstacle.polygon.length, 0),
      contours.exterior?.polygon.length ?? 0,
    ) > 2000
  )
    return []
  const openings = contours.rooms.flatMap((room) =>
    (room.openings ?? [])
      .filter((opening) => opening.kind === 'door')
      .map((opening) => ({ room, opening })),
  )
  const sourceIssue =
    source.state !== 'existing'
      ? 'not-existing-state'
      : work.clippedPaths > 0
        ? 'incomplete-vector-layer'
        : (pdfContourIssue(work, source, contours) ??
          planPageFeaturesIssue(contours, { checkRoomOverlap: true }))
  if (sourceIssue)
    return openings.map(({ room, opening }) => ({
      ...pdfContourIdentity(room),
      openingId: opening.id,
      status: 'unresolved',
      reason: sourceIssue,
    }))

  const segments = new Map<string, PdfOpeningJamb>()
  for (const path of work.paths) {
    // Open dimension leaders and fill-only arrowheads cannot prove a door reveal.
    if (!path.closed || path.paint === 'fill') continue
    for (let index = 0; index < path.points.length; index++) {
      const start = path.points[index]
      const end = path.points[(index + 1) % path.points.length]
      if (!start || !end || samePoint(start, end)) continue
      const key = segmentKey(start, end)
      const jamb: PdfOpeningJamb = {
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: index,
        start: { ...start },
        end: { ...end },
      }
      const before = segments.get(key)
      // PDF drawings may paint the same wall outline several times. Identical native
      // segments prove one geometry; retain a deterministic reference without moving it.
      if (
        !before ||
        jamb.operationIndex < before.operationIndex ||
        (jamb.operationIndex === before.operationIndex &&
          (jamb.subpathIndex < before.subpathIndex ||
            (jamb.subpathIndex === before.subpathIndex && jamb.segmentIndex < before.segmentIndex)))
      )
        segments.set(key, jamb)
    }
  }
  const jambBetween = (a: PagePoint, b: PagePoint) => segments.get(segmentKey(a, b))
  const faces = openings.map(({ room, opening }) => openingFace(room, opening))
  return openings.map(({ room, opening }, index) => {
    const reference = { ...pdfContourIdentity(room), openingId: opening.id }
    const face = faces[index]
    if (!face) return { ...reference, status: 'unresolved', reason: 'non-exact-axis-aligned-face' }
    const matches: Array<{ face: Face; jambs: [PdfOpeningJamb, PdfOpeningJamb] }> = []
    for (const other of faces) {
      if (
        !other ||
        face.roomKey === other.roomKey ||
        face.along !== other.along ||
        face.low[face.along] !== other.low[face.along] ||
        face.high[face.along] !== other.high[face.along]
      )
        continue
      const separation = other.low[face.across] - face.low[face.across]
      // Interiors must face away from the strip between distinct annotated faces.
      // Coincident logical closures (e.g. the stepped bedroom threshold) are not wall thickness.
      if (
        separation === 0 ||
        Math.sign(separation) === face.interiorSide ||
        Math.sign(separation) !== other.interiorSide
      )
        continue
      const low = jambBetween(face.low, other.low)
      const high = jambBetween(face.high, other.high)
      if (low && high) matches.push({ face: other, jambs: [low, high] })
    }
    if (matches.length > 1)
      return { ...reference, status: 'ambiguous', reason: 'competing-native-door-faces' }
    const match = matches[0]
    return match
      ? { ...reference, status: 'candidate', opposite: match.face.reference, jambs: match.jambs }
      : { ...reference, status: 'unresolved', reason: 'no-two-native-jambs' }
  })
}

/** Retain a pair once, only when both faces have the same unique opposite. */
export function pairPlanPageOpeningFaces(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
): PdfOpeningFacePair[] {
  const checks = verifyPlanPageOpeningFaces(work, source, contours)
  const key = (face: PdfOpeningFaceReference) =>
    JSON.stringify([pdfContourKey(face), face.openingId])
  return checks.flatMap((check) => {
    if (check.status !== 'candidate' || key(check) >= key(check.opposite)) return []
    const opposite = checks.find((other) => key(other) === key(check.opposite))
    if (opposite?.status !== 'candidate' || key(opposite.opposite) !== key(check)) return []
    const reference: PdfOpeningFaceReference = {
      ...pdfContourIdentity(check),
      openingId: check.openingId,
    }
    return [{ openings: [reference, check.opposite], jambs: check.jambs }]
  })
}
