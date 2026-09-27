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
type DimensionAxis = 'width' | 'depth'
export type PdfDimensionChain =
  | {
      status: 'candidate'
      roomSourceNumber: number
      totalMm: number
      axis: DimensionAxis
      labelIndexes: number[]
      lineOperations: number[]
      ends: [PagePoint, PagePoint]
      segments: Array<{ labelIndex: number; valueMm: number; start: PagePoint; end: PagePoint }>
      basis: 'manual-page-contour'
    }
  | { status: 'unresolved' | 'ambiguous'; roomSourceNumber: null; reason: string }

export type PdfOpeningAnnotation = {
  kind: 'window' | 'balcony'
  wallEdgeIndex: number
  labelIndex: number
  widthMm: number
  offsetMm: number
}
export type PdfOpeningBinding =
  | {
      status: 'candidate'
      roomSourceNumber: number
      kind: PdfOpeningAnnotation['kind']
      widthMm: number
      offsetFromLeftMm: number
      labelIndex: number
      start: PagePoint
      end: PagePoint
      basis: 'manual-opening-annotation-with-native-dimension'
    }
  | { status: 'unresolved' | 'ambiguous'; roomSourceNumber: null; reason: string }

/** Opening kind/edge are manually reviewed. Only its printed horizontal span is checked here. */
export function pdfOpeningFromWidthChain(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  labels: readonly NativeLabel[],
  totalMm: number,
  opening: PdfOpeningAnnotation,
): PdfOpeningBinding {
  const fail = (reason: string): PdfOpeningBinding => ({
    status: 'unresolved',
    roomSourceNumber: null,
    reason,
  })
  const chain = pdfWidthChain(work, source, contours, roomSourceNumber, labels, totalMm)
  if (chain.status !== 'candidate') return chain
  if (
    !['window', 'balcony'].includes(opening.kind) ||
    !Number.isSafeInteger(opening.wallEdgeIndex) ||
    opening.wallEdgeIndex < 0 ||
    !Number.isSafeInteger(opening.widthMm) ||
    opening.widthMm < 1 ||
    !Number.isSafeInteger(opening.offsetMm) ||
    opening.offsetMm < 0
  )
    return fail('invalid-opening-annotation')
  const room = contours.rooms.find((r) => r.roomSourceNumber === roomSourceNumber)
  if (!room) return fail('no-annotated-room')
  const a = room.polygon[opening.wallEdgeIndex]
  const b = room.polygon[(opening.wallEdgeIndex + 1) % room.polygon.length]
  if (!a || !b || a.y !== b.y) return fail('opening-edge-not-horizontal')
  const index = chain.segments.findIndex((segment) => segment.labelIndex === opening.labelIndex)
  const span = chain.segments[index]
  if (!span) return fail('opening-label-not-in-chain')
  const offsetMm = chain.segments.slice(0, index).reduce((sum, segment) => sum + segment.valueMm, 0)
  if (span.valueMm !== opening.widthMm || offsetMm !== opening.offsetMm)
    return fail('opening-dimension-conflict')
  const close = (p: PagePoint, q: PagePoint) => pdfPointDistance(work, p, q) <= 0.12
  if (
    !close({ x: Math.min(a.x, b.x), y: a.y }, { x: chain.ends[0].x, y: a.y }) ||
    !close({ x: Math.max(a.x, b.x), y: a.y }, { x: chain.ends[1].x, y: a.y })
  )
    return fail('opening-edge-does-not-span-chain')
  const edgeGap = Math.abs(a.y - chain.ends[0].y) * (work.pageHeight / 1000)
  // A manually chosen edge must not project a nearby dimension row onto the opposite wall.
  // This checks the annotation; it does not infer the opening kind or select another edge.
  for (let i = 0; i < room.polygon.length; i++) {
    if (i === opening.wallEdgeIndex) continue
    const left = room.polygon[i]
    const right = room.polygon[(i + 1) % room.polygon.length]
    if (
      !left ||
      !right ||
      left.y !== right.y ||
      !close({ x: Math.min(left.x, right.x), y: a.y }, { x: chain.ends[0].x, y: a.y }) ||
      !close({ x: Math.max(left.x, right.x), y: a.y }, { x: chain.ends[1].x, y: a.y })
    )
      continue
    const otherGap = Math.abs(left.y - chain.ends[0].y) * (work.pageHeight / 1000)
    if (Math.abs(otherGap - edgeGap) <= 0.12)
      return { status: 'ambiguous', roomSourceNumber: null, reason: 'opening-edge-equidistant' }
    if (otherGap < edgeGap) return fail('opening-edge-not-near-chain')
  }
  return {
    status: 'candidate',
    roomSourceNumber,
    kind: opening.kind,
    widthMm: span.valueMm,
    offsetFromLeftMm: offsetMm,
    labelIndex: span.labelIndex,
    start: { x: span.start.x, y: a.y },
    end: { x: span.end.x, y: a.y },
    basis: 'manual-opening-annotation-with-native-dimension',
  }
}

/** Preserve the original width API; both axes use the same connection and contour checks. */
export function pdfWidthChain(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  labels: readonly NativeLabel[],
  totalMm: number,
): PdfDimensionChain {
  return pdfDimensionChain(work, source, contours, roomSourceNumber, labels, totalMm, 'width')
}

export function pdfDepthChain(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  labels: readonly NativeLabel[],
  totalMm: number,
): PdfDimensionChain {
  return pdfDimensionChain(work, source, contours, roomSourceNumber, labels, totalMm, 'depth')
}

/** Axis-aligned dimensions with tips facing measured ends. Never derive mm from drawing scale. */
function pdfDimensionChain(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  labels: readonly NativeLabel[],
  totalMm: number,
  axis: DimensionAxis,
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
      label.rotation !== (axis === 'width' ? 0 : 90) ||
      ![label.x, label.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)
    )
      return fail('invalid-dimension-labels')
  }
  if (labels.reduce((sum, label) => sum + Number(label.text), 0) !== totalMm)
    return fail('dimension-sum-conflict')
  const close = (a: PagePoint, b: PagePoint) => pdfPointDistance(work, a, b) <= 0.12
  const along = (point: PagePoint) => (axis === 'width' ? point.x : point.y)
  const across = (point: PagePoint) => (axis === 'width' ? point.y : point.x)
  const acrossScale = (axis === 'width' ? work.pageHeight : work.pageWidth) / 1000
  const at = (position: number, row: number): PagePoint =>
    axis === 'width' ? { x: position, y: row } : { x: row, y: position }
  const arrows = work.paths.flatMap((path) => {
    const arrow = pdfVectorArrow(work, path)
    return arrow && Math.abs((across(arrow.tip) - across(arrow.base)) * acrossScale) <= 0.12
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
    const ordered = [...path.points].sort((a, b) => along(a) - along(b))
    const [a, b] = ordered
    if (!a || !b || along(a) === along(b) || Math.abs((across(a) - across(b)) * acrossScale) > 0.12)
      continue
    const left = arrows.filter((arrow) => close(a, arrow.base) && along(arrow.tip) < along(a))
    const right = arrows.filter((arrow) => close(b, arrow.base) && along(arrow.tip) > along(b))
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
  const sortedLabels = [...labels].sort((a, b) => along(a) - along(b))
  for (const label of sortedLabels) {
    const matching = spans.filter(
      (span) =>
        along(label) > along(span.start) &&
        along(label) < along(span.end) &&
        (across(span.start) - across(label)) * acrossScale >= 0 &&
        (across(span.start) - across(label)) * acrossScale <= 4,
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
  const positions = room.polygon.map(along)
  const row = across(first.start)
  // Both tips must reach the reviewed contour, not only have a plausible sum.
  if (
    pdfBoundaryDistance(work, first.start, room.polygon) > 0.12 ||
    pdfBoundaryDistance(work, last.end, room.polygon) > 0.12 ||
    !close(first.start, at(Math.min(...positions), row)) ||
    !close(last.end, at(Math.max(...positions), row))
  )
    return fail('dimension-does-not-span-room')
  // Split at all contour intersections: a concavity between segment midpoints is still a conflict.
  const cuts = [along(first.start), along(last.end)]
  for (const candidate of contours.rooms) {
    for (let i = 0; i < candidate.polygon.length; i++) {
      const a = candidate.polygon[i]
      const b = candidate.polygon[(i + 1) % candidate.polygon.length]
      if (
        !a ||
        !b ||
        across(a) === across(b) ||
        row < Math.min(across(a), across(b)) ||
        row > Math.max(across(a), across(b))
      )
        continue
      const position =
        along(a) + ((along(b) - along(a)) * (row - across(a))) / (across(b) - across(a))
      if (position > along(first.start) && position < along(last.end)) cuts.push(position)
    }
  }
  const orderedCuts = [...new Set(cuts)].sort((a, b) => a - b)
  for (let i = 1; i < orderedCuts.length; i++) {
    const left = orderedCuts[i - 1]
    const right = orderedCuts[i]
    if (left === undefined || right === undefined) continue
    const owner = pdfRoomAtPoint(work, source, contours, at((left + right) / 2, row))
    if (owner.status !== 'candidate' || owner.roomSourceNumber !== roomSourceNumber)
      return fail('dimension-outside-room')
  }
  return {
    status: 'candidate',
    roomSourceNumber,
    totalMm,
    axis,
    labelIndexes: sortedLabels.map((l) => l.index),
    lineOperations: selected.map((s) => s.operationIndex),
    ends: [first.start, last.end],
    segments: selected.flatMap((span, i) => {
      const label = sortedLabels[i]
      return label
        ? [
            {
              labelIndex: label.index,
              valueMm: Number(label.text),
              start: span.start,
              end: span.end,
            },
          ]
        : []
    }),
    basis: 'manual-page-contour',
  }
}
