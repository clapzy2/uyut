import type { PlanReading } from '@uyut/db'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import type { NativeTextAnchors } from './plan-document'
import {
  exactNativePolygonContains,
  exactNativeSegmentsTouch,
} from './plan-native-exact-intersections'
import { nativeNumberCircleCandidates } from './plan-native-number-circles'
import { nativeOpeningFrameCandidates } from './plan-native-opening-frames'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
} from './plan-page-review'
import type { Bounds, PagePoint, PdfLinework } from './plan-pdf-linework'
import { verifyPlanPageOpeningFaces } from './plan-pdf-opening-faces'
import { type PdfPlanSource, pdfContourKey, pdfContourRoomNumbers } from './plan-pdf-room-binding'

export type ReviewedFrameSide = {
  roomSourceNumbers: number[]
  openingId: string
  kind: 'door' | 'window' | 'balcony'
  frameEdgeIndex: number
  numberCue: 'inside' | 'not-inside' | 'ambiguous' | 'unavailable'
}
export type ReviewedFrameRoomMatch = {
  frameId: string
  status:
    | 'two-reviewed-sides'
    | 'one-reviewed-side'
    | 'coincident-sides'
    | 'ambiguous'
    | 'unresolved'
  sides: ReviewedFrameSide[]
}
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const sameSpan = (a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint) =>
  (samePoint(a, c) && samePoint(b, d)) || (samePoint(a, d) && samePoint(b, c))
const referenceKey = (
  room: { roomSourceNumber?: number; roomSourceNumbers?: number[] },
  id: string,
) =>
  `${[...(room.roomSourceNumbers ?? [room.roomSourceNumber as number])].sort((a, b) => a - b).join('+')}:${id}`

/** Correspondence to a saved manual review, not automatic room/floor ownership. */
export function nativeReviewedFrameRooms(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: NativeTextAnchors['source']
  source: PdfPlanSource
  reading?: PlanReading
}) {
  const frames: ReviewedFrameRoomMatch[] = []
  const finish = (
    status: 'not-saved' | 'unavailable' | 'refused' | 'checked',
    reason?: string,
  ) => ({
    status,
    ...(reason ? { reason } : {}),
    frames: status === 'checked' ? structuredClone(frames) : [],
    basis: 'saved-source-review-frame-side-correspondence' as const,
    roomOwnershipConfirmed: false as const,
    closesFloorBoundary: false as const,
    physicalPassagesAccepted: false as const,
  })
  const { reading, work, source } = input
  const review = reading?.pageReview
  if (!review || !reading) return finish('not-saved')
  if (review.version !== 1) return finish('unavailable', 'unsupported-review-version')
  if (
    source.state !== 'existing' ||
    input.native.originalPdfSha256 !== source.sha256 ||
    input.native.source.page !== source.pdfPage
  )
    return finish('refused', 'different-plan-source')
  const raw = review.contours
  if (
    !raw ||
    !Array.isArray(raw.rooms) ||
    raw.rooms.length > 100 ||
    !Array.isArray(reading.rooms) ||
    reading.rooms.length > 100 ||
    raw.rooms.some(
      (room) =>
        !room ||
        !Array.isArray(room.polygon) ||
        (room.openings !== undefined && !Array.isArray(room.openings)),
    )
  )
    return finish('refused', 'review-work-limit')
  const pointCount = raw.rooms.reduce((sum, room) => sum + room.polygon.length, 0)
  const openingCount = raw.rooms.reduce((sum, room) => sum + (room.openings?.length ?? 0), 0)
  if (pointCount > 2000 || openingCount > 200) return finish('refused', 'review-work-limit')
  const parsed = planPageContoursSchema.safeParse(raw)
  if (!parsed.success) return finish('refused', 'invalid-reviewed-contours')
  const contours = parsed.data
  const numbers = reading.rooms.map((room) => room.sourceNumber)
  if (
    numbers.some((number) => !isPlanRoomSourceNumber(number)) ||
    new Set(numbers).size !== numbers.length
  )
    return finish('refused', 'incomplete-room-identity-inventory')
  const issue =
    planPageFeaturesIssue(contours, { checkRoomOverlap: true }) ??
    planPageReviewIssue(contours, reading, source, work)
  if (issue) return finish('refused', issue)
  let inventory: ReturnType<typeof nativeOpeningFrameCandidates>
  try {
    inventory = nativeOpeningFrameCandidates(input)
  } catch {
    return finish('unavailable', 'source-frame-unavailable')
  }
  if (inventory.refusalReason) return finish('unavailable', inventory.refusalReason)
  const circles = nativeNumberCircleCandidates(input)
  const checks = verifyPlanPageOpeningFaces(work, source, contours)
  if (
    checks.some(
      (check) => check.status !== 'candidate' && check.reason === 'opening-strip-work-limit',
    )
  )
    return finish('unavailable', 'opening-strip-work-limit')
  const checkMap = new Map(checks.map((check) => [referenceKey(check, check.openingId), check]))
  let remaining = 200_000
  const spend = () => --remaining >= 0
  const cueCache = new Map<string, ReviewedFrameSide['numberCue']>()
  const numberCue = (room: (typeof contours.rooms)[number]): ReviewedFrameSide['numberCue'] => {
    const key = pdfContourKey(room)
    const cached = cueCache.get(key)
    if (cached) return cached
    if (circles.status === 'unresolved') return 'unavailable'
    let status: ReviewedFrameSide['numberCue'] = 'inside'
    for (const number of pdfContourRoomNumbers(room)) {
      remaining -= circles.cues.length
      if (remaining < 0) return 'unavailable'
      const candidates = circles.cues.filter((cue) => cue.sourceNumber === number)
      if (candidates.length > 1) {
        status = 'ambiguous'
        break
      }
      const cue = candidates[0]
      if (!cue) {
        status = 'not-inside'
        continue
      }
      // Containment uses the complete original control hull, not a fitted circle
      // box: a slightly overshooting control point must not strengthen ownership.
      const points = [
        cue.curve.start,
        ...cue.curve.segments.flatMap((segment) =>
          segment.kind === 'cubic'
            ? [segment.control1, segment.control2, segment.end]
            : segment.kind === 'quadratic'
              ? [segment.control, segment.end]
              : [segment.end],
        ),
      ]
      const bounds: Bounds = {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      }
      const polygon = [
        { x: bounds.left, y: bounds.top },
        { x: bounds.right, y: bounds.top },
        { x: bounds.right, y: bounds.bottom },
        { x: bounds.left, y: bounds.bottom },
      ]
      remaining -= room.polygon.length * polygon.length
      if (remaining < 0) return 'unavailable'
      if (exactNativePolygonContains(room.polygon, polygon) !== true) {
        status = 'not-inside'
        continue
      }
      // Whole symbolic frame strictly inside, never baseline-only/proximity ownership.
      for (const [index, a] of room.polygon.entries()) {
        const b = room.polygon[(index + 1) % room.polygon.length]
        if (!b) {
          status = 'not-inside'
          break
        }
        for (const [side, c] of polygon.entries()) {
          if (!spend()) return 'unavailable'
          const d = polygon[(side + 1) % polygon.length]
          if (!d || exactNativeSegmentsTouch({ start: a, end: b }, { start: c, end: d }) !== false)
            status = 'not-inside'
        }
      }
    }
    cueCache.set(key, status)
    return status
  }
  for (const frame of inventory.candidates) {
    const matches: Array<{ side: ReviewedFrameSide; reference: string }> = []
    for (const edge of frame.longEdges)
      for (const room of contours.rooms)
        for (const opening of room.openings ?? []) {
          if (!spend()) return finish('unavailable', 'frame-room-work-limit')
          if (!sameSpan(edge.start, edge.end, opening.start, opening.end)) continue
          matches.push({
            side: {
              roomSourceNumbers: [...pdfContourRoomNumbers(room)].sort((a, b) => a - b),
              openingId: opening.id,
              kind: opening.kind,
              frameEdgeIndex: edge.segmentIndex,
              numberCue: numberCue(room),
            },
            reference: referenceKey(room, opening.id),
          })
          if (remaining < 0) return finish('unavailable', 'frame-room-work-limit')
          if (matches.length > 50) return finish('unavailable', 'frame-room-side-limit')
        }
    const sides = matches.map((match) => match.side)
    const zones = new Set(sides.map((side) => side.roomSourceNumbers.join('+')))
    const edges = new Set(sides.map((side) => side.frameEdgeIndex))
    let status: ReviewedFrameRoomMatch['status'] = 'unresolved'
    if (matches.length === 1) status = 'one-reviewed-side'
    else if (matches.length > 1 && edges.size === 1 && zones.size === matches.length)
      status = 'coincident-sides'
    else if (matches.length > 2 || (matches.length > 1 && zones.size !== matches.length))
      status = 'ambiguous'
    else if (matches.length === 2 && zones.size === 2 && edges.size === 2) {
      const first = matches[0]
      const second = matches[1]
      const a = first ? checkMap.get(first.reference) : undefined
      const b = second ? checkMap.get(second.reference) : undefined
      if (
        a?.status === 'candidate' &&
        b?.status === 'candidate' &&
        referenceKey(a.opposite, a.opposite.openingId) === second?.reference &&
        referenceKey(b.opposite, b.opposite.openingId) === first?.reference &&
        frame.jambs.every((jamb) =>
          a.jambs.some((proof) =>
            sameSpan(jamb.frameEdge.start, jamb.frameEdge.end, proof.start, proof.end),
          ),
        )
      )
        status = 'two-reviewed-sides'
      else if (first?.side.kind !== second?.side.kind) status = 'ambiguous'
    }
    frames.push({ frameId: frame.id, status, sides })
  }
  // A declaration reused by distinct native frames is not a nearest-frame choice.
  const claims = new Map<string, Set<string>>()
  for (const frame of frames)
    for (const side of frame.sides) {
      const key = `${side.roomSourceNumbers.join('+')}:${side.openingId}`
      const owners = claims.get(key) ?? new Set<string>()
      owners.add(frame.frameId)
      claims.set(key, owners)
    }
  for (const frame of frames)
    if (
      frame.sides.some(
        (side) =>
          (claims.get(`${side.roomSourceNumbers.join('+')}:${side.openingId}`)?.size ?? 0) > 1,
      )
    )
      frame.status = 'ambiguous'
  return finish('checked')
}
