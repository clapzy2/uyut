import type { PlanPageContours, PlanPageReview, PlanReading } from '@uyut/db'
import { z } from 'zod'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  pdfBoundaryDistance,
  pdfContourIssue,
  pdfPointInside,
} from './plan-pdf-room-binding'

const pointSchema = z.strictObject({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
})
const featureIdSchema = z.string().min(1).max(80).regex(/^\S+$/)
const openingSchema = z.strictObject({
  id: featureIdSchema,
  kind: z.enum(['door', 'window', 'balcony']),
  wallEdgeIndex: z.number().int().min(0).max(99),
  start: pointSchema,
  end: pointSchema,
})
const obstacleSchema = z.strictObject({
  id: featureIdSchema,
  kind: z.enum(['shaft', 'column', 'fixed']),
  polygon: z.array(pointSchema).min(3).max(100),
})

/** Browser input is bounded before polygon intersection checks or PDF processing. */
export const planPageContoursSchema = z
  .strictObject({
    source: z.strictObject({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      pdfPage: z.number().int().min(1).max(10_000),
      state: z.enum(['existing', 'proposed']),
    }),
    coordinateSystem: z.literal('page-0-1000'),
    review: z.literal('manual-source-review'),
    pageWidth: z.number().positive().max(100_000),
    pageHeight: z.number().positive().max(100_000),
    rooms: z
      .array(
        z.strictObject({
          roomSourceNumber: z.number().int().min(1).max(10_000),
          polygon: z.array(pointSchema).min(3).max(100),
          openings: z.array(openingSchema).max(32).optional(),
          obstacles: z.array(obstacleSchema).max(20).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((input, context) => {
    const issue = planPageFeaturesIssue(input)
    if (issue) context.addIssue({ code: 'custom', message: issue })
  })

const openingEdgeTolerancePt = 0.12
const cross = (a: PagePoint, b: PagePoint) => a.x * b.y - a.y * b.x
const difference = (a: PagePoint, b: PagePoint) => ({ x: a.x - b.x, y: a.y - b.y })
const between = (a: PagePoint, b: PagePoint, ratio: number) => ({
  x: a.x + (b.x - a.x) * ratio,
  y: a.y + (b.y - a.y) * ratio,
})

function pointOnSegment(point: PagePoint, a: PagePoint, b: PagePoint): boolean {
  const direction = difference(b, a)
  const squaredLength = direction.x ** 2 + direction.y ** 2
  if (squaredLength === 0) return point.x === a.x && point.y === a.y
  const offset = difference(point, a)
  const along = offset.x * direction.x + offset.y * direction.y
  // Unlike opening-to-wall alignment, polygon containment has no outward allowance.
  // A near-boundary point must not be accepted as a boundary point by an epsilon band.
  return cross(direction, offset) === 0 && along >= 0 && along <= squaredLength
}

function pointOnBoundary(point: PagePoint, polygon: readonly PagePoint[]): boolean {
  return polygon.some((a, index) => {
    const b = polygon[(index + 1) % polygon.length]
    return b !== undefined && pointOnSegment(point, a, b)
  })
}

function strictlyInside(point: PagePoint, polygon: readonly PagePoint[]): boolean {
  return !pointOnBoundary(point, polygon) && pdfPointInside(point, polygon)
}

/** Split at every boundary intersection, including a concave vertex and collinear runs. */
function boundaryRatios(a: PagePoint, b: PagePoint, polygon: readonly PagePoint[]): number[] {
  const direction = difference(b, a)
  const squaredLength = direction.x ** 2 + direction.y ** 2
  const ratios = [0, 1]
  for (let index = 0; index < polygon.length; index++) {
    const c = polygon[index]
    const d = polygon[(index + 1) % polygon.length]
    if (!c || !d) continue
    const otherDirection = difference(d, c)
    const denominator = cross(direction, otherDirection)
    const offset = difference(c, a)
    if (denominator !== 0) {
      const ratio = cross(offset, otherDirection) / denominator
      const otherRatio = cross(offset, direction) / denominator
      if (ratio >= 0 && ratio <= 1 && otherRatio >= 0 && otherRatio <= 1) ratios.push(ratio)
    } else {
      for (const point of [c, d]) {
        if (pointOnSegment(point, a, b)) {
          const delta = difference(point, a)
          ratios.push((delta.x * direction.x + delta.y * direction.y) / squaredLength)
        }
      }
    }
  }
  return [...new Set(ratios)].sort((left, right) => left - right)
}

function edgeSamples(a: PagePoint, b: PagePoint, polygon: readonly PagePoint[]): PagePoint[] {
  const ratios = boundaryRatios(a, b, polygon)
  const samples: PagePoint[] = []
  for (let index = 1; index < ratios.length; index++) {
    const start = ratios[index - 1]
    const end = ratios[index]
    if (start !== undefined && end !== undefined && end > start)
      samples.push(between(a, b, (start + end) / 2))
  }
  return samples
}

function polygonWithin(polygon: readonly PagePoint[], boundary: readonly PagePoint[]): boolean {
  const within = (point: PagePoint) =>
    pointOnBoundary(point, boundary) || pdfPointInside(point, boundary)
  return polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length]
    return b !== undefined && within(a) && edgeSamples(a, b, boundary).every(within)
  })
}

/** Positive-area overlap is refused; adjoining contours may share a wall or a corner. */
function polygonsOverlap(left: readonly PagePoint[], right: readonly PagePoint[]): boolean {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    const a = left[leftIndex]
    const b = left[(leftIndex + 1) % left.length]
    if (!a || !b) continue
    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      const c = right[rightIndex]
      const d = right[(rightIndex + 1) % right.length]
      if (!c || !d) continue
      const abC = cross(difference(b, a), difference(c, a))
      const abD = cross(difference(b, a), difference(d, a))
      const cdA = cross(difference(d, c), difference(a, c))
      const cdB = cross(difference(d, c), difference(b, c))
      const opposite = (first: number, second: number) =>
        (first > 0 && second < 0) || (first < 0 && second > 0)
      if (opposite(abC, abD) && opposite(cdA, cdB)) return true
    }
  }
  const edgeInside = (polygon: readonly PagePoint[], other: readonly PagePoint[]) =>
    polygon.some((a, index) => {
      const b = polygon[(index + 1) % polygon.length]
      return (
        b !== undefined && edgeSamples(a, b, other).some((point) => strictlyInside(point, other))
      )
    })
  if (edgeInside(left, right) || edgeInside(right, left)) return true
  // Identical polygons (or shared boundary runs enclosing the same area) have no edge
  // midpoint strictly inside the other polygon. Probe both sides of each boundary edge.
  return left.some((a, index) => {
    const b = left[(index + 1) % left.length]
    if (!b) return false
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const midpoint = between(a, b, 0.5)
    for (const distance of [0.001, 0.00001, 0.0000001, 0.000000001, 0.00000000001]) {
      for (const side of [-1, 1]) {
        const point = {
          x: midpoint.x - ((b.y - a.y) * distance * side) / length,
          y: midpoint.y + ((b.x - a.x) * distance * side) / length,
        }
        if (strictlyInside(point, left) && strictlyInside(point, right)) return true
      }
    }
    return false
  })
}

/** Geometry checks do not infer a feature's semantic kind or a metric room dimension. */
export function planPageFeaturesIssue(
  input: PlanPageContours,
  options: { checkRoomOverlap?: boolean } = {},
): string | undefined {
  const hasFeatures = input.rooms.some(
    (room) => (room.openings?.length ?? 0) > 0 || (room.obstacles?.length ?? 0) > 0,
  )
  // Older polygon-only annotations keep their save contract. Metric conversion must also
  // check room intersections when there are no annotated openings or obstacles.
  if (!hasFeatures && !options.checkRoomOverlap) return undefined
  const featureCount = input.rooms.reduce(
    (total, room) => total + (room.openings?.length ?? 0) + (room.obstacles?.length ?? 0),
    0,
  )
  const vertexCount = input.rooms.reduce(
    (total, room) =>
      total +
      room.polygon.length +
      (room.obstacles ?? []).reduce((count, obstacle) => count + obstacle.polygon.length, 0) +
      (room.openings?.length ?? 0) * 2,
    0,
  )
  if (featureCount > 200 || vertexCount > 2000) return 'page-features-too-complex'
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    paths: [],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
  if (pdfContourIssue(work, input.source, input)) return 'invalid-room-contours'
  for (let roomIndex = 0; roomIndex < input.rooms.length; roomIndex++) {
    const room = input.rooms[roomIndex]
    if (!room) continue
    if (
      input.rooms.slice(roomIndex + 1).some((other) => polygonsOverlap(room.polygon, other.polygon))
    )
      return 'overlapping-room-contours'
    const ids = new Set<string>()
    const intervals = new Map<number, Array<{ start: number; end: number }>>()
    for (const feature of [...(room.openings ?? []), ...(room.obstacles ?? [])]) {
      if (ids.has(feature.id)) return 'duplicate-page-feature-id'
      ids.add(feature.id)
    }
    for (const opening of room.openings ?? []) {
      const a = room.polygon[opening.wallEdgeIndex]
      const b = room.polygon[(opening.wallEdgeIndex + 1) % room.polygon.length]
      if (!a || !b) return 'unknown-opening-wall-edge'
      const scaled = (point: PagePoint) => ({
        x: (point.x * input.pageWidth) / 1000,
        y: (point.y * input.pageHeight) / 1000,
      })
      const direction = difference(scaled(b), scaled(a))
      const squaredLength = direction.x ** 2 + direction.y ** 2
      const ratio = (point: PagePoint) => {
        const offset = difference(scaled(point), scaled(a))
        return (offset.x * direction.x + offset.y * direction.y) / squaredLength
      }
      const start = Math.min(ratio(opening.start), ratio(opening.end))
      const end = Math.max(ratio(opening.start), ratio(opening.end))
      if (
        start < 0 ||
        end > 1 ||
        end <= start ||
        pdfBoundaryDistance(work, opening.start, [a, b]) > openingEdgeTolerancePt ||
        pdfBoundaryDistance(work, opening.end, [a, b]) > openingEdgeTolerancePt
      )
        return 'opening-outside-wall-edge'
      const edgeIntervals = intervals.get(opening.wallEdgeIndex) ?? []
      if (edgeIntervals.some((other) => start < other.end && end > other.start))
        return 'overlapping-page-openings'
      edgeIntervals.push({ start, end })
      intervals.set(opening.wallEdgeIndex, edgeIntervals)
    }
    const obstacles = room.obstacles ?? []
    for (let index = 0; index < obstacles.length; index++) {
      const obstacle = obstacles[index]
      if (!obstacle) continue
      const obstacleContours = {
        ...input,
        rooms: [{ roomSourceNumber: room.roomSourceNumber, polygon: obstacle.polygon }],
      }
      if (pdfContourIssue(work, input.source, obstacleContours)) return 'invalid-page-obstacle'
      if (!polygonWithin(obstacle.polygon, room.polygon)) return 'obstacle-outside-room-contour'
      if (
        obstacles.slice(index + 1).some((other) => polygonsOverlap(obstacle.polygon, other.polygon))
      )
        return 'overlapping-page-obstacles'
    }
  }
  return undefined
}

/** A printed number must identify one room; names and list order are not substitutes. */
export function pageReviewRoomsMatch(
  contours: PlanPageContours,
  reading: Pick<PlanReading, 'rooms'>,
): boolean {
  return contours.rooms.every(
    (contour) =>
      reading.rooms.filter((room) => room.sourceNumber === contour.roomSourceNumber).length === 1,
  )
}

export function planPageReviewIssue(
  input: PlanPageContours,
  reading: PlanReading,
  source: PdfPlanSource,
  linework: PdfLinework,
): string | undefined {
  if (reading.sourcePage !== source.pdfPage || reading.planState !== source.state)
    return 'different-reading-source'
  if (!pageReviewRoomsMatch(input, reading)) return 'unknown-room-number'
  if (linework.paths.length === 0) return 'missing-vector-layer'
  const issue = pdfContourIssue(linework, source, input)
  if (issue) return issue
  const featureIssue = planPageFeaturesIssue(input)
  if (featureIssue) return featureIssue
  // A client can bypass snapping. Verify every saved vertex against the freshly extracted
  // PDF coordinates without silently snapping, rounding, or expanding the proof tolerance.
  const nativePoints = new Set<string>()
  for (const path of linework.paths) {
    for (const point of path.points) nativePoints.add(`${point.x}:${point.y}`)
  }
  if (
    input.rooms.some((room) =>
      room.polygon.some((point) => !nativePoints.has(`${point.x}:${point.y}`)),
    )
  )
    return 'non-native-contour-vertex'
  for (const room of input.rooms) {
    for (const opening of room.openings ?? []) {
      if (
        !nativePoints.has(`${opening.start.x}:${opening.start.y}`) ||
        !nativePoints.has(`${opening.end.x}:${opening.end.y}`)
      )
        return 'non-native-opening-vertex'
    }
    if (
      (room.obstacles ?? []).some((obstacle) =>
        obstacle.polygon.some((point) => !nativePoints.has(`${point.x}:${point.y}`)),
      )
    )
      return 'non-native-obstacle-vertex'
  }
  return undefined
}

/** Keep a review only while its page, state and unambiguous printed identities survive. */
export function retainedPlanPageReview(
  before: PlanReading,
  after: Pick<PlanReading, 'rooms' | 'sourcePage' | 'planState'>,
): PlanPageReview | undefined {
  const review = before.pageReview
  if (review?.version !== 1) return undefined
  const parsed = planPageContoursSchema.safeParse(review.contours)
  if (
    !parsed.success ||
    parsed.data.source.pdfPage !== after.sourcePage ||
    parsed.data.source.state !== after.planState ||
    !pageReviewRoomsMatch(parsed.data, before) ||
    !pageReviewRoomsMatch(parsed.data, after)
  )
    return undefined
  return review
}
