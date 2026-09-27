import type { PlanPageOpening } from '@uyut/db'
import { pdfVectorArrow } from './plan-pdf-leaders'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type NativePageSegment,
  nativePageSegments,
  sourceOpeningEndpoint,
} from './plan-pdf-opening-endpoint'
import {
  type PdfPlanSource,
  type PdfRoomContours,
  pdfBoundaryDistance,
  pdfContourIssue,
  pdfPointDistance,
  pdfPointInside,
  pdfRoomAtPoint,
} from './plan-pdf-room-binding'

type NativeLabel = PagePoint & { index: number; text: string; rotation: number }
type DimensionAxis = 'width' | 'depth'
type NativeDimensionSpan = {
  start: PagePoint
  end: PagePoint
  operationIndex: number
  branched: boolean
}

type NativeOpeningSpan = PlanPageOpening

export type PdfNativeOpeningBinding =
  | {
      status: 'candidate'
      roomSourceNumber: number
      id: string
      kind: NativeOpeningSpan['kind']
      wallEdgeIndex: number
      axis: DimensionAxis
      widthMm: number
      labelIndex: number
      start: PagePoint
      end: PagePoint
      basis: 'manual-opening-annotation-with-native-dimension'
    }
  | { status: 'unresolved' | 'ambiguous'; roomSourceNumber: null; reason: string }

/** Check one printed opening span, without requiring a complete room dimension chain. */
export function pdfOpeningFromNativeSpan(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  label: NativeLabel,
  opening: NativeOpeningSpan,
): PdfNativeOpeningBinding {
  return createPdfOpeningSpanVerifier(work, source, contours)(roomSourceNumber, label, opening)
}

/** Reuse native evidence only within one request's unchanged source/contour snapshot. */
export function createPdfOpeningSpanVerifier(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
): (
  roomSourceNumber: number,
  label: NativeLabel,
  opening: NativeOpeningSpan,
) => PdfNativeOpeningBinding {
  const issue = pdfContourIssue(work, source, contours)
  const nativePoints = new Set(
    issue ? [] : work.paths.flatMap((path) => path.points.map((point) => `${point.x}:${point.y}`)),
  )
  const spansByAxis: Partial<Record<DimensionAxis, NativeDimensionSpan[]>> = {}
  const segments = nativePageSegments(work)
  const spansFor = (axis: DimensionAxis) => {
    const existing = spansByAxis[axis]
    if (existing) return existing
    const spans = nativeDimensionSpans(work, axis, true)
    spansByAxis[axis] = spans
    return spans
  }
  const pointInRoom = (point: PagePoint, roomSourceNumber: number) => {
    if (contours.rooms.some((room) => pdfBoundaryDistance(work, point, room.polygon) <= 0.5))
      return false
    const owners = contours.rooms.filter((room) => pdfPointInside(point, room.polygon))
    return owners.length === 1 && owners[0]?.roomSourceNumber === roomSourceNumber
  }
  return (roomSourceNumber, label, opening) =>
    pdfOpeningFromPreparedNativeSpan(work, source, contours, roomSourceNumber, label, opening, {
      issue,
      nativePoints,
      segments,
      spansFor,
      pointInRoom,
    })
}

function pdfOpeningFromPreparedNativeSpan(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  label: NativeLabel,
  opening: NativeOpeningSpan,
  evidence: {
    issue: string | undefined
    nativePoints: ReadonlySet<string>
    segments: readonly NativePageSegment[]
    spansFor(axis: DimensionAxis): NativeDimensionSpan[]
    pointInRoom(point: PagePoint, roomSourceNumber: number): boolean
  },
): PdfNativeOpeningBinding {
  const fail = (
    reason: string,
    status: 'unresolved' | 'ambiguous' = 'unresolved',
  ): PdfNativeOpeningBinding => ({ status, reason, roomSourceNumber: null })
  if (evidence.issue) return fail(evidence.issue)
  const room = contours.rooms.find((candidate) => candidate.roomSourceNumber === roomSourceNumber)
  if (!room) return fail('no-annotated-room')
  if (
    typeof opening.id !== 'string' ||
    opening.id.length < 1 ||
    !['door', 'window', 'balcony'].includes(opening.kind) ||
    !Number.isSafeInteger(opening.wallEdgeIndex) ||
    opening.wallEdgeIndex < 0 ||
    opening.wallEdgeIndex >= room.polygon.length ||
    ![opening.start.x, opening.start.y, opening.end.x, opening.end.y].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
    )
  )
    return fail('invalid-opening-annotation')
  const a = room.polygon[opening.wallEdgeIndex]
  const b = room.polygon[(opening.wallEdgeIndex + 1) % room.polygon.length]
  if (!a || !b || (a.x !== b.x && a.y !== b.y)) return fail('opening-edge-not-axis-aligned')
  const axis: DimensionAxis = a.y === b.y ? 'width' : 'depth'
  const along = (point: PagePoint) => (axis === 'width' ? point.x : point.y)
  const across = (point: PagePoint) => (axis === 'width' ? point.y : point.x)
  const alongScale = (axis === 'width' ? work.pageWidth : work.pageHeight) / 1000
  const acrossScale = (axis === 'width' ? work.pageHeight : work.pageWidth) / 1000
  const endpoints = [opening.start, opening.end].sort((left, right) => along(left) - along(right))
  const [start, end] = endpoints
  if (
    !start ||
    !end ||
    along(start) === along(end) ||
    endpoints.some(
      (point) =>
        across(point) !== across(a) ||
        along(point) < Math.min(along(a), along(b)) ||
        along(point) > Math.max(along(a), along(b)),
    )
  )
    return fail('opening-span-not-on-declared-edge')
  const segments = opening.endpointProofs ? evidence.segments : []
  if (
    !sourceOpeningEndpoint(
      opening.start,
      opening.endpointProofs?.start,
      [a, b],
      evidence.nativePoints,
      segments,
    ) ||
    !sourceOpeningEndpoint(
      opening.end,
      opening.endpointProofs?.end,
      [a, b],
      evidence.nativePoints,
      segments,
    )
  )
    return fail('non-native-opening-endpoint')
  if (
    !Number.isSafeInteger(label.index) ||
    label.index < 0 ||
    !/^\d{1,5}$/.test(label.text) ||
    Number(label.text) < 1 ||
    label.rotation !== (axis === 'width' ? 0 : 90) ||
    ![label.x, label.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)
  )
    return fail('invalid-dimension-labels')
  if (!evidence.pointInRoom(label, roomSourceNumber)) return fail('opening-label-outside-room')
  const matching = evidence
    .spansFor(axis)
    .filter(
      (span) =>
        along(label) > along(span.start) &&
        along(label) < along(span.end) &&
        (across(span.start) - across(label)) * acrossScale >= 0 &&
        (across(span.start) - across(label)) * acrossScale <= 4 &&
        Math.abs((along(span.start) - along(start)) * alongScale) <= 0.12 &&
        Math.abs((along(span.end) - along(end)) * alongScale) <= 0.12,
    )
  if (matching.length !== 1)
    return fail(
      matching.length > 1 ? 'multiple-dimension-lines' : 'no-connected-opening-dimension',
      matching.length > 1 ? 'ambiguous' : 'unresolved',
    )
  const span = matching[0]
  if (!span) return fail('no-connected-opening-dimension')
  if (span.branched) return fail('branched-dimension-line', 'ambiguous')
  const middle = {
    x: (span.start.x + span.end.x) / 2,
    y: (span.start.y + span.end.y) / 2,
  }
  if (!evidence.pointInRoom(middle, roomSourceNumber)) return fail('opening-dimension-outside-room')
  if (
    !dimensionIntervalInsideRoom(
      work,
      source,
      contours,
      roomSourceNumber,
      span.start,
      span.end,
      axis,
      evidence.pointInRoom,
    )
  )
    return fail('opening-dimension-outside-room')
  const gap = Math.abs(across(a) - across(span.start)) * acrossScale
  for (let index = 0; index < room.polygon.length; index++) {
    if (index === opening.wallEdgeIndex) continue
    const left = room.polygon[index]
    const right = room.polygon[(index + 1) % room.polygon.length]
    if (
      !left ||
      !right ||
      across(left) !== across(right) ||
      Math.min(along(left), along(right)) > along(start) ||
      Math.max(along(left), along(right)) < along(end)
    )
      continue
    const otherGap = Math.abs(across(left) - across(span.start)) * acrossScale
    if (Math.abs(otherGap - gap) <= 0.12) return fail('opening-edge-equidistant', 'ambiguous')
    if (otherGap < gap) return fail('opening-edge-not-near-dimension')
  }
  return {
    status: 'candidate',
    roomSourceNumber,
    id: opening.id,
    kind: opening.kind,
    wallEdgeIndex: opening.wallEdgeIndex,
    axis,
    widthMm: Number(label.text),
    labelIndex: label.index,
    start: { ...start },
    end: { ...end },
    basis: 'manual-opening-annotation-with-native-dimension',
  }
}
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
  const spans = nativeDimensionSpans(work, axis)
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
  if (
    !dimensionIntervalInsideRoom(
      work,
      source,
      contours,
      roomSourceNumber,
      first.start,
      last.end,
      axis,
    )
  )
    return fail('dimension-outside-room')
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

/** A narrow concavity or overlapping contour between midpoints is still a conflict. */
function dimensionIntervalInsideRoom(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  roomSourceNumber: number,
  start: PagePoint,
  end: PagePoint,
  axis: DimensionAxis,
  pointInRoom?: (point: PagePoint, roomSourceNumber: number) => boolean,
): boolean {
  const along = (point: PagePoint) => (axis === 'width' ? point.x : point.y)
  const across = (point: PagePoint) => (axis === 'width' ? point.y : point.x)
  const at = (position: number, row: number): PagePoint =>
    axis === 'width' ? { x: position, y: row } : { x: row, y: position }
  const row = across(start)
  const cuts = [along(start), along(end)]
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
      if (position > along(start) && position < along(end)) cuts.push(position)
    }
  }
  const orderedCuts = [...new Set(cuts)].sort((a, b) => a - b)
  for (let i = 1; i < orderedCuts.length; i++) {
    const left = orderedCuts[i - 1]
    const right = orderedCuts[i]
    if (left === undefined || right === undefined) continue
    const point = at((left + right) / 2, row)
    if (pointInRoom) {
      if (!pointInRoom(point, roomSourceNumber)) return false
    } else {
      const owner = pdfRoomAtPoint(work, source, contours, point)
      if (owner.status !== 'candidate' || owner.roomSourceNumber !== roomSourceNumber) return false
    }
  }
  return true
}

/** Shared bounded native arrow/stem proof; it does not classify a wall or opening. */
function nativeDimensionSpans(
  work: PdfLinework,
  axis: DimensionAxis,
  collapseRepeatedNativePaint = false,
): NativeDimensionSpan[] {
  const close = (a: PagePoint, b: PagePoint) => pdfPointDistance(work, a, b) <= 0.12
  const along = (point: PagePoint) => (axis === 'width' ? point.x : point.y)
  const across = (point: PagePoint) => (axis === 'width' ? point.y : point.x)
  const acrossScale = (axis === 'width' ? work.pageHeight : work.pageWidth) / 1000
  const arrowPaint = new Set<string>()
  const arrows = work.paths.flatMap((path) => {
    const arrow = pdfVectorArrow(work, path)
    if (!arrow || Math.abs((across(arrow.tip) - across(arrow.base)) * acrossScale) > 0.12) return []
    if (collapseRepeatedNativePaint) {
      // Some native PDFs repaint the same filled triangle. Exact paint is the same arrow,
      // unlike a shifted/reshaped arrowhead or a competing line. The legacy API stays strict.
      const key = `${path.paint}:${path.points.map((point) => `${point.x}:${point.y}`).join('|')}`
      if (arrowPaint.has(key)) return []
      arrowPaint.add(key)
    }
    return [arrow]
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
  const spans: NativeDimensionSpan[] = []
  for (const path of work.paths) {
    if (path.closed || path.paint !== 'stroke' || path.points.length !== 2) continue
    const ordered = [...path.points].sort((a, b) => along(a) - along(b))
    const [a, b] = ordered
    if (!a || !b || along(a) === along(b) || Math.abs((across(a) - across(b)) * acrossScale) > 0.12)
      continue
    const left = arrows.filter((arrow) => close(a, arrow.base) && along(arrow.tip) < along(a))
    const right = arrows.filter((arrow) => close(b, arrow.base) && along(arrow.tip) > along(b))
    if (collapseRepeatedNativePaint && (left.length > 1 || right.length > 1)) {
      // Competing arrows cannot establish a unique span. Keep a fail-closed representative
      // instead of allocating the Cartesian product of every possible endpoint pairing.
      const first = left[0]
      const last = right[0]
      if (first && last)
        spans.push({
          start: first.tip,
          end: last.tip,
          operationIndex: path.operationIndex,
          branched: true,
        })
      continue
    }
    // Do not select one of two competing arrowheads at an endpoint.
    const branched = strokes.some((stroke) => {
      if (
        stroke.operationIndex === path.operationIndex &&
        stroke.subpathIndex === path.subpathIndex
      )
        return false
      if (![stroke.start, stroke.end].some((point) => close(point, a) || close(point, b)))
        return false
      // A native retrace wholly inside the exact selected rail adds no branch geometry.
      // Do not exempt near-collinear, off-axis or extending strokes, or change the legacy gate.
      const containedRetrace =
        collapseRepeatedNativePaint &&
        across(a) === across(b) &&
        [stroke.start, stroke.end].every(
          (point) =>
            across(point) === across(a) && along(point) >= along(a) && along(point) <= along(b),
        )
      return !containedRetrace
    })
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
  return spans
}
