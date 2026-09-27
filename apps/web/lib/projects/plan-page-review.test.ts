import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  planPageContoursSchema,
  planPageReviewIssue,
  retainedPlanPageReview,
} from './plan-page-review'
import type { PdfLinework } from './plan-pdf-linework'

const contours: PlanPageContours = {
  source: { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' },
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: 842,
  pageHeight: 1191,
  rooms: [
    {
      roomSourceNumber: 4,
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    },
  ],
}
const reading: PlanReading = {
  sourcePage: 6,
  planState: 'existing',
  readAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
  pageReview: { version: 1, savedAt: '2026-09-27', contours },
}
const linework: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 842,
  pageHeight: 1191,
  paths: [
    {
      operationIndex: 1,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    },
  ],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}

describe('versioned source page review', () => {
  it('accepts a bounded contour for the unique printed room number', () => {
    expect(planPageContoursSchema.safeParse(contours).success).toBe(true)
    expect(planPageReviewIssue(contours, reading, contours.source, linework)).toBeUndefined()
  })

  it.each([
    null,
    { ...contours, extra: true },
    { ...contours, rooms: [] },
    { ...contours, pageWidth: Infinity },
    { ...contours, rooms: [{ roomSourceNumber: 4, polygon: [{ x: -1, y: 2 }] }] },
  ])('rejects malformed browser input without throwing', (input) => {
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })

  it('rejects duplicate rooms and self-crossing contours', () => {
    expect(
      planPageReviewIssue(
        { ...contours, rooms: [...contours.rooms, ...contours.rooms] },
        reading,
        contours.source,
        linework,
      ),
    ).toBe('invalid-room-contours')
    const polygon = [
      { x: 10, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
      { x: 30, y: 10 },
    ]
    expect(
      planPageReviewIssue(
        { ...contours, rooms: [{ roomSourceNumber: 4, polygon }] },
        reading,
        contours.source,
        linework,
      ),
    ).toBe('invalid-room-contours')
  })

  it('rejects different source files, page formats, and incomplete native layers', () => {
    expect(
      planPageReviewIssue(
        contours,
        reading,
        { ...contours.source, sha256: 'b'.repeat(64) },
        linework,
      ),
    ).toBe('different-plan-source')
    expect(
      planPageReviewIssue(contours, reading, contours.source, { ...linework, pageWidth: 1000 }),
    ).toBe('different-page-format')
    expect(
      planPageReviewIssue(contours, reading, contours.source, { ...linework, truncated: true }),
    ).toBe('incomplete-vector-layer')
    expect(
      planPageReviewIssue(contours, reading, contours.source, { ...linework, paths: [] }),
    ).toBe('missing-vector-layer')
  })

  it('does not bind by a matching name without a unique printed number', () => {
    expect(
      planPageReviewIssue(
        contours,
        { ...reading, rooms: [{ name: 'Спальня', kind: 'bedroom' }] },
        contours.source,
        linework,
      ),
    ).toBe('unknown-room-number')
    expect(
      planPageReviewIssue(
        contours,
        { ...reading, rooms: [...reading.rooms, ...reading.rooms] },
        contours.source,
        linework,
      ),
    ).toBe('unknown-room-number')
  })

  it('rejects valid-looking vertices that were not taken from the exact native layer', () => {
    const changed = structuredClone(contours)
    const vertex = changed.rooms[0]?.polygon[0]
    if (!vertex) throw new Error('Missing contour vertex')
    vertex.x += 0.1
    expect(planPageReviewIssue(changed, reading, contours.source, linework)).toBe(
      'non-native-contour-vertex',
    )
  })

  it('preserves renamed rooms and coordinate review without confirming measurements', () => {
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing source room')
    const after = {
      ...reading,
      rooms: [{ ...room, name: 'Моя спальня', widthCm: 400 }],
    }
    expect(retainedPlanPageReview(reading, after)).toEqual(reading.pageReview)
    expect(after.rooms[0]).not.toHaveProperty('verification')
  })

  it.each([
    { ...reading, sourcePage: 12 },
    { ...reading, planState: 'proposed' as const },
    { ...reading, rooms: [] },
    { ...reading, rooms: [...reading.rooms, ...reading.rooms] },
  ])('drops review when source identity changes', (after) => {
    expect(retainedPlanPageReview(reading, after)).toBeUndefined()
  })

  it('includes page review changes in the existing edit revision', async () => {
    const { planEditRevision } = await import('./plan-edit-revision')
    expect(planEditRevision('plan.pdf', reading)).not.toBe(
      planEditRevision('plan.pdf', { ...reading, pageReview: undefined }),
    )
  })
})
