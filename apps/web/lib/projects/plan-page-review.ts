import type { PlanPageContours, PlanPageReview, PlanReading } from '@uyut/db'
import { z } from 'zod'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type NativePageSegment,
  nativePageSegments,
  sourceOpeningEndpoint,
} from './plan-pdf-opening-endpoint'
import {
  type PdfPlanSource,
  pdfBoundaryDistance,
  pdfContourIdentity,
  pdfContourIssue,
  pdfContourRoomNumbers,
  pdfPointInside,
  pdfPolygonIsValid,
} from './plan-pdf-room-binding'

const pointSchema = z.strictObject({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
})
const featureIdSchema = z.string().min(1).max(80).regex(/^\S+$/)
const endpointProofSchema = z.strictObject({
  kind: z.literal('native-edge-crossing'),
  operationIndex: z.number().int().min(0).max(99_999),
  subpathIndex: z.number().int().min(0).max(19_999),
  segmentIndex: z.number().int().min(0).max(19_999),
})
const openingSchema = z.strictObject({
  id: featureIdSchema,
  kind: z.enum(['door', 'window', 'balcony']),
  wallEdgeIndex: z.number().int().min(0).max(99),
  start: pointSchema,
  end: pointSchema,
  endpointProofs: z
    .strictObject({
      start: endpointProofSchema.optional(),
      end: endpointProofSchema.optional(),
    })
    .optional(),
})
const obstacleSchema = z.strictObject({
  id: featureIdSchema,
  kind: z.enum(['shaft', 'column', 'fixed']),
  polygon: z.array(pointSchema).min(3).max(100),
})
const conditionalEdgeSchema = z.strictObject({
  wallEdgeIndex: z.number().int().min(0).max(99),
  endpointProofs: z
    .strictObject({ start: endpointProofSchema.optional(), end: endpointProofSchema.optional() })
    .optional(),
})
const sourceNumberSchema = z.number().int().min(1).max(10_000)
const contourFields = {
  polygon: z.array(pointSchema).min(3).max(100),
  conditionalEdges: z.array(conditionalEdgeSchema).max(100).optional(),
  dimensionEdges: z
    .array(
      z.strictObject({
        wallEdgeIndex: z.number().int().min(0).max(99),
        labelIndexes: z
          .array(z.number().int().min(0).max(19_999))
          .min(1)
          .max(20)
          .refine((indexes) => new Set(indexes).size === indexes.length),
      }),
    )
    .max(12)
    .optional(),
  openings: z.array(openingSchema).max(32).optional(),
  obstacles: z.array(obstacleSchema).max(20).optional(),
}
const contourSchema = z.union([
  z.strictObject({ roomSourceNumber: sourceNumberSchema, ...contourFields }),
  z.strictObject({
    roomSourceNumbers: z.array(sourceNumberSchema).min(2).max(12),
    ...contourFields,
  }),
])

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
    exterior: z
      .strictObject({
        polygon: z.array(pointSchema).min(3).max(100),
        boundaryRole: z.enum(['floor', 'outer-wall-envelope']).optional(),
      })
      .optional(),
    floor: z.strictObject({ polygon: z.array(pointSchema).min(3).max(100) }).optional(),
    voids: z
      .array(z.strictObject({ id: featureIdSchema, polygon: z.array(pointSchema).min(3).max(100) }))
      .max(20)
      .optional(),
    rooms: z.array(contourSchema).min(1).max(100),
  })
  .superRefine((input, context) => {
    const dimensions = input.rooms.flatMap((room) => room.dimensionEdges ?? [])
    if (dimensions.length > 12)
      context.addIssue({ code: 'custom', message: 'too-many-edge-dimensions' })
    for (const room of input.rooms) {
      const edges = room.dimensionEdges ?? []
      if (
        new Set(edges.map((edge) => edge.wallEdgeIndex)).size !== edges.length ||
        edges.some((edge) => edge.wallEdgeIndex >= room.polygon.length)
      )
        context.addIssue({ code: 'custom', message: 'invalid-dimension-edge' })
    }
    const numbers = input.rooms.flatMap((room) => [...pdfContourRoomNumbers(room)])
    if (new Set(numbers).size !== numbers.length)
      context.addIssue({ code: 'custom', message: 'duplicate-room-membership' })
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
  // Preserve exact source-edge incidence instead of re-testing a rounded midpoint.
  // An interpolated point on a diagonal can have a nonzero floating determinant.
  if (
    polygon.some((c, index) => {
      const d = polygon[(index + 1) % polygon.length]
      return d && pointOnSegment(a, c, d) && pointOnSegment(b, c, d)
    })
  )
    return []
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

export function segmentWithinPolygon(
  a: PagePoint,
  b: PagePoint,
  boundary: readonly PagePoint[],
): boolean {
  const within = (point: PagePoint) =>
    pointOnBoundary(point, boundary) || pdfPointInside(point, boundary)
  return within(a) && within(b) && edgeSamples(a, b, boundary).every(within)
}

export function polygonWithin(
  polygon: readonly PagePoint[],
  boundary: readonly PagePoint[],
): boolean {
  return polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length]
    return b !== undefined && segmentWithinPolygon(a, b, boundary)
  })
}

/** Positive-area overlap is refused; adjoining contours may share a wall or a corner. */
export function polygonsOverlap(left: readonly PagePoint[], right: readonly PagePoint[]): boolean {
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
  // Coincident boundary runs overlap in area only when both interiors lie on the
  // same side. Use original edge directions, never tiny offset probes that round
  // onto a shared diagonal and invent a positive-area intersection.
  const winding = (polygon: readonly PagePoint[]) =>
    Math.sign(
      polygon.reduce((sum, a, index) => {
        const b = polygon[(index + 1) % polygon.length]
        return b ? sum + cross(a, b) : sum
      }, 0),
    )
  const leftSign = winding(left)
  const rightSign = winding(right)
  return left.some((a, index) => {
    const b = left[(index + 1) % left.length]
    if (!b) return false
    const direction = difference(b, a)
    const axis = Math.abs(direction.x) >= Math.abs(direction.y) ? 'x' : 'y'
    return right.some((c, otherIndex) => {
      const d = right[(otherIndex + 1) % right.length]
      if (
        !d ||
        cross(direction, difference(c, a)) !== 0 ||
        cross(direction, difference(d, a)) !== 0
      )
        return false
      const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
      const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
      return (
        low < high &&
        leftSign * Math.sign(b[axis] - a[axis]) === rightSign * Math.sign(d[axis] - c[axis])
      )
    })
  })
}

/** Boundary contact is allowed; any open subinterval inside the polygon is not. */
export function segmentEntersPolygon(
  a: PagePoint,
  b: PagePoint,
  polygon: readonly PagePoint[],
): boolean {
  return edgeSamples(a, b, polygon).some((point) => strictlyInside(point, polygon))
}

/** Geometry checks do not infer a feature's semantic kind or a metric room dimension. */
export function planPageFeaturesIssue(
  input: PlanPageContours,
  options: { checkRoomOverlap?: boolean } = {},
): string | undefined {
  const hasFeatures = input.rooms.some(
    (room) =>
      (room.openings?.length ?? 0) > 0 ||
      (room.obstacles?.length ?? 0) > 0 ||
      (room.conditionalEdges?.length ?? 0) > 0,
  )
  // Older polygon-only annotations keep their save contract. Metric conversion must also
  // check room intersections when there are no annotated openings or obstacles.
  if (
    !hasFeatures &&
    !options.checkRoomOverlap &&
    !input.exterior &&
    !input.floor &&
    !input.voids?.length
  )
    return undefined
  const featureCount = input.rooms.reduce(
    (total, room) => total + (room.openings?.length ?? 0) + (room.obstacles?.length ?? 0),
    input.voids?.length ?? 0,
  )
  const vertexCount = input.rooms.reduce(
    (total, room) =>
      total +
      room.polygon.length +
      (room.obstacles ?? []).reduce((count, obstacle) => count + obstacle.polygon.length, 0) +
      (room.openings?.length ?? 0) * 2,
    (input.exterior?.polygon.length ?? 0) +
      (input.floor?.polygon.length ?? 0) +
      (input.voids ?? []).reduce((total, voidArea) => total + voidArea.polygon.length, 0),
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
  const exterior = input.exterior
  const floor = input.floor
  if (floor) {
    if (exterior?.boundaryRole !== 'outer-wall-envelope')
      return 'floor-requires-outer-wall-envelope'
    if (!pdfPolygonIsValid(floor.polygon)) return 'invalid-floor-contour'
    if (!polygonWithin(floor.polygon, exterior.polygon)) return 'floor-outside-exterior-contour'
    if (input.rooms.some((room) => !polygonWithin(room.polygon, floor.polygon)))
      return 'room-outside-floor-contour'
  }
  if (exterior && input.rooms.some((room) => !polygonWithin(room.polygon, exterior.polygon)))
    return 'room-outside-exterior-contour'
  const voids = input.voids ?? []
  if (voids.length > 20) return 'too-many-page-voids'
  if (new Set(voids.map((voidArea) => voidArea.id)).size !== voids.length)
    return 'duplicate-page-void-id'
  for (const [index, voidArea] of voids.entries()) {
    if (!pdfPolygonIsValid(voidArea.polygon)) return 'invalid-page-void'
    if (exterior && !polygonWithin(voidArea.polygon, exterior.polygon))
      return 'void-outside-exterior-contour'
    if (floor && !polygonWithin(voidArea.polygon, floor.polygon))
      return 'void-outside-floor-contour'
    if (input.rooms.some((room) => polygonsOverlap(voidArea.polygon, room.polygon)))
      return 'void-overlaps-room-contour'
    if (voids.slice(index + 1).some((other) => polygonsOverlap(voidArea.polygon, other.polygon)))
      return 'overlapping-page-voids'
  }
  for (let roomIndex = 0; roomIndex < input.rooms.length; roomIndex++) {
    const room = input.rooms[roomIndex]
    if (!room) continue
    if (
      input.rooms.slice(roomIndex + 1).some((other) => polygonsOverlap(room.polygon, other.polygon))
    )
      return 'overlapping-room-contours'
    const ids = new Set<string>()
    const intervals = new Map<number, Array<{ start: number; end: number }>>()
    const conditionalIndexes = (room.conditionalEdges ?? []).map((edge) => edge.wallEdgeIndex)
    if (
      new Set(conditionalIndexes).size !== conditionalIndexes.length ||
      conditionalIndexes.some((index) => {
        const start = room.polygon[index]
        const end = room.polygon[(index + 1) % room.polygon.length]
        return !start || !end || (start.x !== end.x && start.y !== end.y)
      })
    )
      return 'invalid-conditional-edge'
    for (const feature of [...(room.openings ?? []), ...(room.obstacles ?? [])]) {
      if (ids.has(feature.id)) return 'duplicate-page-feature-id'
      ids.add(feature.id)
    }
    for (const opening of room.openings ?? []) {
      if (conditionalIndexes.includes(opening.wallEdgeIndex)) return 'opening-on-conditional-edge'
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
        rooms: [{ ...pdfContourIdentity(room), polygon: obstacle.polygon }],
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
  return contours.rooms.every((contour) =>
    pdfContourRoomNumbers(contour).every(
      (number) => reading.rooms.filter((room) => room.sourceNumber === number).length === 1,
    ),
  )
}

/** A conditional endpoint may lie at a proven crossing, never at a guessed page coordinate. */
export function sourceRoomContourVertices(
  room: Pick<PlanPageContours['rooms'][number], 'polygon' | 'conditionalEdges'>,
  nativePoints: ReadonlySet<string>,
  segments: readonly NativePageSegment[],
): boolean {
  for (const edge of room.conditionalEdges ?? []) {
    const start = room.polygon[edge.wallEdgeIndex]
    const end = room.polygon[(edge.wallEdgeIndex + 1) % room.polygon.length]
    if (
      !start ||
      !end ||
      (start.x !== end.x && start.y !== end.y) ||
      (!nativePoints.has(`${start.x}:${start.y}`) && !nativePoints.has(`${end.x}:${end.y}`))
    )
      return false
  }
  return room.polygon.every((point, index) => {
    if (nativePoints.has(`${point.x}:${point.y}`)) return true
    const ownEdge = room.conditionalEdges?.find((edge) => edge.wallEdgeIndex === index)
    const priorIndex = (index - 1 + room.polygon.length) % room.polygon.length
    const priorEdge = room.conditionalEdges?.find((edge) => edge.wallEdgeIndex === priorIndex)
    const ownEnd = room.polygon[(index + 1) % room.polygon.length]
    const priorStart = room.polygon[priorIndex]
    return Boolean(
      (ownEdge &&
        ownEnd &&
        sourceOpeningEndpoint(
          point,
          ownEdge.endpointProofs?.start,
          [point, ownEnd],
          nativePoints,
          segments,
        )) ||
        (priorEdge &&
          priorStart &&
          sourceOpeningEndpoint(
            point,
            priorEdge.endpointProofs?.end,
            [priorStart, point],
            nativePoints,
            segments,
          )),
    )
  })
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
  const segments = nativePageSegments(linework)
  for (const room of input.rooms) {
    if (!sourceRoomContourVertices(room, nativePoints, segments)) return 'non-native-contour-vertex'
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
          nativePoints,
          segments,
        ) ||
        !sourceOpeningEndpoint(
          opening.end,
          opening.endpointProofs?.end,
          [a, b],
          nativePoints,
          segments,
        )
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
  if (input.exterior?.polygon.some((point) => !nativePoints.has(`${point.x}:${point.y}`)))
    return 'non-native-contour-vertex'
  if (input.floor?.polygon.some((point) => !nativePoints.has(`${point.x}:${point.y}`)))
    return 'non-native-floor-vertex'
  if (
    input.voids?.some((voidArea) =>
      voidArea.polygon.some((point) => !nativePoints.has(`${point.x}:${point.y}`)),
    )
  )
    return 'non-native-void-vertex'
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
