import type {
  PlanPageContours,
  PlanPageOpening,
  PlanPageRoomIdentity,
  PlanPageSegmentRef,
} from '@uyut/db'
import {
  exactNativePolygonContains,
  exactNativePolygonsOverlap,
} from './plan-native-exact-intersections'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  sourceRoomContourVertices,
} from './plan-page-review'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { nativePageSegments } from './plan-pdf-opening-endpoint'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'
import {
  type PdfPlanSource,
  pdfContourIdentity,
  pdfContourIssue,
  pdfContourKey,
  pdfPolygonIsValid,
} from './plan-pdf-room-binding'

export type PdfOpeningFaceReference = PlanPageRoomIdentity & { openingId: string }
export type PdfOpeningJamb = {
  operationIndex: number
  subpathIndex: number
  segmentIndex: number
  start: PagePoint
  end: PagePoint
  strokeSegment?: PlanPageSegmentRef
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

/** A PDF may fill a hairline-wide reveal and paint only its inner outline.
 * The outer edge is still native geometry, but the painted edge must belong to
 * the same exact rectangular fill; nearby unrelated strokes do not count.
 */
function thinRevealOutline(
  points: PagePoint[],
  start: PagePoint,
  end: PagePoint,
  strokes: Map<string, PlanPageSegmentRef>,
): PlanPageSegmentRef | undefined {
  const first = points[0]
  const last = points.at(-1)
  const corners = first && last && samePoint(first, last) ? points.slice(0, -1) : points
  if (corners.length !== 4) return undefined
  const xs = [...new Set(corners.map((point) => point.x))]
  const ys = [...new Set(corners.map((point) => point.y))]
  if (xs.length !== 2 || ys.length !== 2) return undefined
  if (new Set(corners.map((point) => `${point.x}:${point.y}`)).size !== 4) return undefined

  const vertical = start.x === end.x
  const horizontal = start.y === end.y
  if (vertical === horizontal) return undefined
  const across = vertical ? xs : ys
  const alongLength = vertical ? Math.abs(end.y - start.y) : Math.abs(end.x - start.x)
  if (
    across[0] === undefined ||
    across[1] === undefined ||
    alongLength < 1 ||
    Math.abs(across[1] - across[0]) > 0.25
  )
    return undefined

  const other = across[0] === (vertical ? start.x : start.y) ? across[1] : across[0]
  const oppositeStart = vertical ? { x: other, y: start.y } : { x: start.x, y: other }
  const oppositeEnd = vertical ? { x: other, y: end.y } : { x: end.x, y: other }
  return strokes.get(segmentKey(oppositeStart, oppositeEnd))
}

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
    work.paths.length > 5000 ||
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
      (contours.exterior?.polygon.length ?? 0) +
        (contours.floor?.polygon.length ?? 0) +
        (contours.voids ?? []).reduce((sum, voidArea) => sum + voidArea.polygon.length, 0),
    ) > 2000
  )
    return []
  if (!planPageContoursSchema.safeParse(contours).success) return []
  const openings = contours.rooms.flatMap((room) =>
    (room.openings ?? [])
      .filter((opening) => opening.kind === 'door')
      .map((opening) => ({ room, opening })),
  )
  let sourceIssue =
    source.state !== 'existing'
      ? 'not-existing-state'
      : work.clippedPaths > 0
        ? 'incomplete-vector-layer'
        : work.paintBounds && !pdfPaintInventoryIsComplete(work.paintBounds)
          ? 'incomplete-native-paint-layer'
          : (pdfContourIssue(work, source, contours) ??
            planPageFeaturesIssue(contours, { checkRoomOverlap: true }))
  if (!sourceIssue) {
    const nativePoints = new Set(
      work.paths.flatMap((path) => path.points.map((point) => `${point.x}:${point.y}`)),
    )
    const nativeSegments = nativePageSegments(work)
    if (
      contours.rooms.some(
        (room) => !sourceRoomContourVertices(room, nativePoints, nativeSegments),
      ) ||
      (contours.exterior &&
        !sourceRoomContourVertices(contours.exterior, nativePoints, nativeSegments))
    )
      sourceIssue = 'non-native-contour-vertex'
  }
  if (sourceIssue)
    return openings.map(({ room, opening }) => ({
      ...pdfContourIdentity(room),
      openingId: opening.id,
      status: 'unresolved',
      reason: sourceIssue,
    }))

  const segments = new Map<string, PdfOpeningJamb>()
  const strokes = new Map<string, PlanPageSegmentRef>()
  const closedSubpaths = new Map<number, number>()
  const paintedFillEdges = new Map<string, PdfOpeningJamb[]>()
  const lineKey = (a: PagePoint, b: PagePoint) =>
    a.x === b.x ? `x:${a.x}` : a.y === b.y ? `y:${a.y}` : undefined
  const refKey = (ref: PlanPageSegmentRef) =>
    [ref.operationIndex, ref.subpathIndex, ref.segmentIndex]
      .map((n) => String(n).padStart(6, '0'))
      .join(':')
  for (const path of work.paths) {
    if (path.closed)
      closedSubpaths.set(path.operationIndex, (closedSubpaths.get(path.operationIndex) ?? 0) + 1)
    if (path.paint === 'fill') continue
    const count = path.closed ? path.points.length : path.points.length - 1
    for (let index = 0; index < count; index++) {
      const start = path.points[index]
      const end = path.points[(index + 1) % path.points.length]
      if (!start || !end || samePoint(start, end)) continue
      const key = segmentKey(start, end)
      const ref = {
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: index,
      }
      const previous = strokes.get(key)
      if (!previous || refKey(ref) < refKey(previous)) strokes.set(key, ref)
    }
  }
  for (const path of work.paths) {
    // A fill needs its own simple outline and an exact independently painted reveal.
    // Open leaders alone never become reveals; compound fills may contain holes.
    if (!path.closed) continue
    if (path.paint === 'fill') {
      const first = path.points[0]
      const last = path.points.at(-1)
      const points =
        first && last && samePoint(first, last) ? path.points.slice(0, -1) : path.points
      if (
        points.length > 100 ||
        closedSubpaths.get(path.operationIndex) !== 1 ||
        !pdfPolygonIsValid(points)
      )
        continue
    }
    for (let index = 0; index < path.points.length; index++) {
      const start = path.points[index]
      const end = path.points[(index + 1) % path.points.length]
      if (!start || !end || samePoint(start, end)) continue
      const key = segmentKey(start, end)
      const strokeSegment =
        path.paint === 'fill'
          ? (strokes.get(key) ?? thinRevealOutline(path.points, start, end, strokes))
          : undefined
      const jamb: PdfOpeningJamb = {
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: index,
        start: { ...start },
        end: { ...end },
        ...(strokeSegment ? { strokeSegment } : {}),
      }
      if (path.paint === 'fill') {
        const line = lineKey(start, end)
        if (line) {
          const edges = paintedFillEdges.get(line) ?? []
          edges.push(jamb)
          paintedFillEdges.set(line, edges)
        }
      }
      if (path.paint === 'fill' && !strokeSegment) continue
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
  for (const path of work.paths) {
    // A two-point painted line is a reveal only when it follows a native filled
    // wall outline. An unsupported dimension leader remains just a stroke.
    if (path.closed || path.paint === 'fill' || path.points.length !== 2) continue
    const [start, end] = path.points
    if (!start || !end || samePoint(start, end)) continue
    const line = lineKey(start, end)
    if (!line) continue
    const along = start.x === end.x ? 'y' : 'x'
    const supports = (paintedFillEdges.get(line) ?? []).filter(
      (edge) =>
        Math.min(edge.start[along], edge.end[along]) <= Math.min(start[along], end[along]) &&
        Math.max(edge.start[along], edge.end[along]) >= Math.max(start[along], end[along]),
    )
    if (new Set(supports.map((edge) => segmentKey(edge.start, edge.end))).size !== 1) continue
    const support = supports[0]
    if (!support) continue
    const key = segmentKey(start, end)
    if (segments.has(key)) continue
    segments.set(key, {
      ...support,
      strokeSegment: {
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: 0,
      },
    })
  }
  const jambBetween = (a: PagePoint, b: PagePoint) => segments.get(segmentKey(a, b))
  const paintEvents = pdfPaintInventoryIsComplete(work.paintBounds)
    ? work.paintBounds?.events
    : undefined
  const strokeSpan = (ref: PlanPageSegmentRef): [PagePoint, PagePoint] | undefined => {
    const path = work.paths.find(
      (item) =>
        item.operationIndex === ref.operationIndex && item.subpathIndex === ref.subpathIndex,
    )
    const start = path?.points[ref.segmentIndex]
    const end = path?.points[(ref.segmentIndex + 1) % path.points.length]
    return start && end ? [start, end] : undefined
  }
  const visibleJamb = (jamb: PdfOpeningJamb): boolean => {
    if (!paintEvents) return true
    const nativeRef: PlanPageSegmentRef = {
      operationIndex: jamb.operationIndex,
      subpathIndex: jamb.subpathIndex,
      segmentIndex: jamb.segmentIndex,
    }
    const witnesses: Array<{ ref: PlanPageSegmentRef; span: [PagePoint, PagePoint] }> = [
      { ref: nativeRef, span: [jamb.start, jamb.end] },
    ]
    if (jamb.strokeSegment) {
      const span = strokeSpan(jamb.strokeSegment)
      if (!span) return false
      witnesses.push({ ref: jamb.strokeSegment, span })
    }
    return witnesses.every(({ ref, span }) =>
      paintEvents.every((event) => {
        if (event.operationIndex <= ref.operationIndex) return true
        // The outline stroke is expected to follow its own filled reveal.
        if (
          ref.operationIndex === nativeRef.operationIndex &&
          event.operationIndex === jamb.strokeSegment?.operationIndex
        )
          return true
        return !pdfPaintMayTouchSpan(event, span, 0.0005)
      }),
    )
  }
  const reservedAreas = [
    ...contours.rooms.map((room) => ({
      polygon: room.polygon,
      reason: 'opening-strip-overlaps-room',
    })),
    ...(contours.voids ?? []).map((voidArea) => ({
      polygon: voidArea.polygon,
      reason: 'opening-strip-overlaps-void',
    })),
  ].map((area) => ({
    ...area,
    left: Math.min(...area.polygon.map((point) => point.x)),
    right: Math.max(...area.polygon.map((point) => point.x)),
    top: Math.min(...area.polygon.map((point) => point.y)),
    bottom: Math.max(...area.polygon.map((point) => point.y)),
  }))
  const boundaries = [
    ...(contours.exterior
      ? [{ polygon: contours.exterior.polygon, reason: 'opening-strip-outside-exterior' }]
      : []),
    ...(contours.floor
      ? [{ polygon: contours.floor.polygon, reason: 'opening-strip-outside-floor' }]
      : []),
  ]
  // Request-local geometric reuse: reverse face checks describe the same corridor.
  const stripIssues = new Map<string, string | undefined>()
  let stripWork = 200_000
  const stripIssue = (face: Face, other: Face): string | undefined => {
    const strip = [face.low, face.high, other.high, other.low]
    const left = Math.min(...strip.map((point) => point.x))
    const right = Math.max(...strip.map((point) => point.x))
    const top = Math.min(...strip.map((point) => point.y))
    const bottom = Math.max(...strip.map((point) => point.y))
    const key = JSON.stringify([left, top, right, bottom])
    if (stripIssues.has(key)) return stripIssues.get(key)
    let issue: string | undefined
    for (const boundary of boundaries) {
      stripWork -= strip.length * boundary.polygon.length
      if (stripWork < 0) return 'opening-strip-work-limit'
      if (exactNativePolygonContains(boundary.polygon, strip) !== true) {
        issue = boundary.reason
        break
      }
    }
    if (issue) {
      stripIssues.set(key, issue)
      return issue
    }
    for (const area of reservedAreas) {
      // Boundary-only contact is expected at the two faces and jambs.
      if (area.left >= right || area.right <= left || area.top >= bottom || area.bottom <= top)
        continue
      stripWork -= strip.length * area.polygon.length
      if (stripWork < 0) return 'opening-strip-work-limit'
      // All reviewed rooms participate, including a concave part of a paired room.
      // A midpoint alone can miss an off-centre third owner. Unknown precision holds the pair.
      if (exactNativePolygonsOverlap(strip, area.polygon) !== false) {
        issue = area.reason
        break
      }
    }
    stripIssues.set(key, issue)
    return issue
  }
  const faces = openings.map(({ room, opening }) => openingFace(room, opening))
  const checks: PdfOpeningFaceCheck[] = openings.map(({ room, opening }, index) => {
    const reference = { ...pdfContourIdentity(room), openingId: opening.id }
    const face = faces[index]
    if (!face) return { ...reference, status: 'unresolved', reason: 'non-exact-axis-aligned-face' }
    const matches: Array<{ face: Face; jambs: [PdfOpeningJamb, PdfOpeningJamb] }> = []
    let hasOppositeFace = false
    let corridorIssue: string | undefined
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
      hasOppositeFace = true
      const low = jambBetween(face.low, other.low)
      const high = jambBetween(face.high, other.high)
      if (low && high) {
        if (!visibleJamb(low) || !visibleJamb(high)) {
          corridorIssue = 'painted-over-native-jamb'
        } else {
          const issue = stripIssue(face, other)
          if (issue) corridorIssue = issue
          else matches.push({ face: other, jambs: [low, high] })
        }
      }
    }
    if (matches.length > 1)
      return { ...reference, status: 'ambiguous', reason: 'competing-native-door-faces' }
    const match = matches[0]
    return match
      ? { ...reference, status: 'candidate', opposite: match.face.reference, jambs: match.jambs }
      : {
          ...reference,
          status: 'unresolved',
          reason:
            corridorIssue ?? (hasOppositeFace ? 'no-two-native-jambs' : 'no-opposing-door-face'),
        }
  })
  // A work-limit refusal is atomic; earlier partial matches cannot be reused as proof.
  return stripWork < 0
    ? openings.map(({ room, opening }) => ({
        ...pdfContourIdentity(room),
        openingId: opening.id,
        status: 'unresolved',
        reason: 'opening-strip-work-limit',
      }))
    : checks
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
