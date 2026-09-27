import type { PlanPageContours, PlanPageReview, PlanReading } from '@uyut/db'
import { z } from 'zod'
import type { PdfLinework } from './plan-pdf-linework'
import { type PdfPlanSource, pdfContourIssue } from './plan-pdf-room-binding'

const pointSchema = z.strictObject({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
})

/** Browser input is bounded before polygon intersection checks or PDF processing. */
export const planPageContoursSchema = z.strictObject({
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
      }),
    )
    .min(1)
    .max(100),
})

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
