import { pdfVectorArrow } from './plan-pdf-leaders'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  type PdfRoomContours,
  pdfBoundaryDistance,
  pdfContourIssue,
  pdfPointDistance,
  pdfRoomAtPoint,
} from './plan-pdf-room-binding'

type NativeLabel = PagePoint & { index: number; text: string; rotation: number }
export type PdfDimensionChain =
  | {
      status: 'candidate'
      roomSourceNumber: number
      totalMm: number
      labelIndexes: number[]
      lineOperations: number[]
      ends: [PagePoint, PagePoint]
      basis: 'manual-page-contour'
    }
  | { status: 'unresolved' | 'ambiguous'; roomSourceNumber: null; reason: string }

/** Horizontal dimensions with tips facing the measured ends. Never derive mm from drawing scale. */
export function pdfWidthChain(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  labels: readonly NativeLabel[],
  totalMm: number,
): PdfDimensionChain {
  const fail = (
    reason: string,
    status: 'unresolved' | 'ambiguous' = 'unresolved',
  ): PdfDimensionChain => ({ status, reason, roomSourceNumber: null })
  const issue = pdfContourIssue(work, source, contours)
  if (issue) return fail(issue)
  const room = contours.rooms.find((r) => r.roomSourceNumber === roomSourceNumber)
  if (!room) return fail('no-annotated-room')
  if (
    !Number.isSafeInteger(totalMm) ||
    totalMm < 1 ||
    labels.length < 1 ||
    labels.length > 20 ||
    new Set(labels.map((l) => l.index)).size !== labels.length
  )
    return fail('invalid-dimension-labels')
  for (const label of labels) {
    if (
      !Number.isSafeInteger(label.index) ||
      label.index < 0 ||
      !/^\d{1,5}$/.test(label.text) ||
      Number(label.text) < 1 ||
      label.rotation !== 0 ||
      ![label.x, label.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)
    )
      return fail('invalid-dimension-labels')
  }
  if (labels.reduce((sum, label) => sum + Number(label.text), 0) !== totalMm)
    return fail('dimension-sum-conflict')
  const close = (a: PagePoint, b: PagePoint) => pdfPointDistance(work, a, b) <= 0.12
  const arrows = work.paths.flatMap((path) => {
    const arrow = pdfVectorArrow(work, path)
    return arrow && Math.abs(((arrow.tip.y - arrow.base.y) * work.pageHeight) / 1000) <= 0.12
      ? [arrow]
      : []
  })
  const strokes = work.paths.flatMap((path) => {
    if (path.closed || path.paint !== 'stroke') return []
    return path.points.slice(1).flatMap((end, i) => {
      const start = path.points[i]
      return start
        ? [{ start, end, operationIndex: path.operationIndex, subpathIndex: path.subpathIndex }]
        : []
    })
  })
  const spans: Array<{
    start: PagePoint
    end: PagePoint
    operationIndex: number
    branched: boolean
  }> = []
  for (const path of work.paths) {
    if (path.closed || path.paint !== 'stroke' || path.points.length !== 2) continue
    const ordered = [...path.points].sort((a, b) => a.x - b.x)
    const [a, b] = ordered
    if (!a || !b || a.x === b.x || Math.abs(((a.y - b.y) * work.pageHeight) / 1000) > 0.12) continue
    const left = arrows.filter((arrow) => close(a, arrow.base) && arrow.tip.x < a.x)
    const right = arrows.filter((arrow) => close(b, arrow.base) && arrow.tip.x > b.x)
    // Do not select one of two competing arrowheads at an endpoint.
    const branched = strokes.some(
      (stroke) =>
        (stroke.operationIndex !== path.operationIndex ||
          stroke.subpathIndex !== path.subpathIndex) &&
        [stroke.start, stroke.end].some((point) => close(point, a) || close(point, b)),
    )
    for (const first of left) {
      for (const last of right)
        spans.push({
          start: first.tip,
          end: last.tip,
          operationIndex: path.operationIndex,
          branched,
        })
    }
  }
  const selected: typeof spans = []
  for (const label of [...labels].sort((a, b) => a.x - b.x)) {
    const matching = spans.filter(
      (span) =>
        label.x > span.start.x &&
        label.x < span.end.x &&
        ((span.start.y - label.y) * work.pageHeight) / 1000 >= 0 &&
        ((span.start.y - label.y) * work.pageHeight) / 1000 <= 4,
    )
    if (matching.length !== 1)
      return fail(
        matching.length > 1 ? 'multiple-dimension-lines' : 'no-connected-dimension-line',
        matching.length > 1 ? 'ambiguous' : 'unresolved',
      )
    const span = matching[0]
    if (!span) return fail('no-connected-dimension-line')
    if (span.branched) return fail('branched-dimension-line', 'ambiguous')
    if (selected.some((s) => s.operationIndex === span.operationIndex))
      return fail('reused-dimension-line')
    const middle = { x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 }
    const owner = pdfRoomAtPoint(work, source, contours, middle)
    if (owner.status !== 'candidate' || owner.roomSourceNumber !== roomSourceNumber)
      return fail('dimension-outside-room')
    selected.push(span)
  }
  for (let i = 1; i < selected.length; i++) {
    const before = selected[i - 1]
    const after = selected[i]
    if (!before || !after || !close(before.end, after.start))
      return fail('disconnected-dimension-chain')
  }
  const first = selected[0]
  const last = selected[selected.length - 1]
  if (!first || !last) return fail('no-connected-dimension-line')
  const xs = room.polygon.map((p) => p.x)
  const rowY = first.start.y
  // Both tips must reach the reviewed contour, not only have a plausible sum.
  if (
    pdfBoundaryDistance(work, first.start, room.polygon) > 0.12 ||
    pdfBoundaryDistance(work, last.end, room.polygon) > 0.12 ||
    !close(first.start, { x: Math.min(...xs), y: rowY }) ||
    !close(last.end, { x: Math.max(...xs), y: rowY })
  )
    return fail('dimension-does-not-span-room')
  // Split at all contour intersections: a concavity between segment midpoints is still a conflict.
  const cuts = [first.start.x, last.end.x]
  for (const candidate of contours.rooms) {
    for (let i = 0; i < candidate.polygon.length; i++) {
      const a = candidate.polygon[i]
      const b = candidate.polygon[(i + 1) % candidate.polygon.length]
      if (!a || !b || a.y === b.y || rowY < Math.min(a.y, b.y) || rowY > Math.max(a.y, b.y))
        continue
      const x = a.x + ((b.x - a.x) * (rowY - a.y)) / (b.y - a.y)
      if (x > first.start.x && x < last.end.x) cuts.push(x)
    }
  }
  const orderedCuts = [...new Set(cuts)].sort((a, b) => a - b)
  for (let i = 1; i < orderedCuts.length; i++) {
    const left = orderedCuts[i - 1]
    const right = orderedCuts[i]
    if (left === undefined || right === undefined) continue
    const owner = pdfRoomAtPoint(work, source, contours, { x: (left + right) / 2, y: rowY })
    if (owner.status !== 'candidate' || owner.roomSourceNumber !== roomSourceNumber)
      return fail('dimension-outside-room')
  }
  return {
    status: 'candidate',
    roomSourceNumber,
    totalMm,
    labelIndexes: [...labels].sort((a, b) => a.x - b.x).map((l) => l.index),
    lineOperations: selected.map((s) => s.operationIndex),
    ends: [first.start, last.end],
    basis: 'manual-page-contour',
  }
}
