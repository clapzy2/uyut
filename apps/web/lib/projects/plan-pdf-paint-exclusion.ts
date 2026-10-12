import type { Bounds, PagePoint, PdfPaintBounds } from './plan-pdf-linework'

type PaintEvent = PdfPaintBounds['events'][number]

const pointValid = (point: PagePoint | undefined): point is PagePoint =>
  !!point && Number.isFinite(point.x) && Number.isFinite(point.y)

const boundsValid = (bounds: Bounds | null) =>
  bounds === null ||
  (!!bounds &&
    [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) &&
    bounds.left <= bounds.right &&
    bounds.top <= bounds.bottom)

/** An inventory can contain unknown envelopes, but must account for every paint operation. */
export function pdfPaintInventoryIsComplete(input: PdfPaintBounds | undefined): boolean {
  if (
    input?.complete !== true ||
    input.refusalReason !== null ||
    !Array.isArray(input.events) ||
    input.events.length > 6000
  )
    return false
  const operations = new Set<number>()
  for (const event of input.events) {
    if (
      !event ||
      !Number.isInteger(event.operationIndex) ||
      event.operationIndex < 0 ||
      event.operationIndex >= 100_000 ||
      operations.has(event.operationIndex) ||
      !['vector', 'text', 'image', 'unknown'].includes(event.kind) ||
      !boundsValid(event.bounds)
    )
      return false
    operations.add(event.operationIndex)
  }
  return true
}

/** False only excludes paint from the entire uncertain span; true does not prove coverage. */
export function pdfPaintMayTouchSpan(
  event: PaintEvent,
  span: [PagePoint, PagePoint],
  error: number,
): boolean {
  if (
    !event ||
    !['vector', 'text', 'image', 'unknown'].includes(event.kind) ||
    !Array.isArray(span) ||
    span.length !== 2 ||
    !span.every(pointValid) ||
    !Number.isFinite(error) ||
    error < 0 ||
    !boundsValid(event.bounds)
  )
    return true
  if (event.bounds === null)
    return !(event.kind === 'text' && event.reason === 'empty-source-text-paint')

  const [first, second] = span
  const bounds = event.bounds
  const pageMagnitude = Math.max(
    1,
    error,
    ...span.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]),
    Math.abs(bounds.left),
    Math.abs(bounds.right),
    Math.abs(bounds.top),
    Math.abs(bounds.bottom),
  )
  const pagePadding = error + 1024 * Number.EPSILON * pageMagnitude
  if (
    Math.max(first.x, second.x) + pagePadding < bounds.left ||
    Math.min(first.x, second.x) - pagePadding > bounds.right ||
    Math.max(first.y, second.y) + pagePadding < bounds.top ||
    Math.min(first.y, second.y) - pagePadding > bounds.bottom
  )
    return false

  // A diagonal span's enclosing box can overlap a distant paint rectangle.
  // Test the span normal as well; inclusive contact and numerical uncertainty
  // remain possible paint, not permission to move either geometry.
  const dx = second.x - first.x
  const dy = second.y - first.y
  const length = Math.hypot(dx, dy)
  if (Number.isFinite(length) && length > 0) {
    const nx = -dy / length
    const ny = dx / length
    const project = (x: number, y: number) => (x - first.x) * nx + (y - first.y) * ny
    const projections = [
      project(bounds.left, bounds.top),
      project(bounds.right, bounds.top),
      project(bounds.right, bounds.bottom),
      project(bounds.left, bounds.bottom),
    ]
    const queryEnd = project(second.x, second.y)
    const normalPadding = pagePadding * (Math.abs(nx) + Math.abs(ny))
    if (
      projections.every(Number.isFinite) &&
      Number.isFinite(queryEnd) &&
      (Math.min(...projections) > Math.max(0, queryEnd) + normalPadding ||
        Math.max(...projections) < Math.min(0, queryEnd) - normalPadding)
    )
      return false
  }

  const region = event.straightStrokeRegion
  if (
    event.kind !== 'vector' ||
    event.subpathCount !== 1 ||
    !region ||
    !pointValid(region.start) ||
    !pointValid(region.end) ||
    !Number.isFinite(region.radius) ||
    region.radius <= 0 ||
    !Array.isArray(region.sourceToPage) ||
    region.sourceToPage.length !== 6 ||
    !region.sourceToPage.every(Number.isFinite)
  )
    return true

  const [a, b, c, d, e, f] = region.sourceToPage
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d))
  if (!scale) return true
  const aa = a / scale
  const bb = b / scale
  const cc = c / scale
  const dd = d / scale
  const determinant = aa * dd - bb * cc
  // Unstable inversion is a refusal, never permission to ignore later paint.
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-10) return true
  const divisor = determinant * scale
  if (!Number.isFinite(divisor) || divisor === 0) return true
  const inverse = [dd / divisor, -bb / divisor, -cc / divisor, aa / divisor]
  if (!inverse.every(Number.isFinite)) return true
  const [ia = 0, ib = 0, ic = 0, id = 0] = inverse
  const local = span.map((point) => ({
    x: ia * (point.x - e) + ic * (point.y - f),
    y: ib * (point.x - e) + id * (point.y - f),
  }))
  if (!local.every(pointValid)) return true
  const [queryStart, queryEnd] = local as [PagePoint, PagePoint]
  const inverseNorm = Math.max(Math.abs(ia) + Math.abs(ic), Math.abs(ib) + Math.abs(id))
  const condition = scale * inverseNorm
  const sourceMagnitude = Math.max(
    1,
    region.radius,
    ...[region.start, region.end, ...local].flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]),
    inverseNorm * Math.max(pageMagnitude, Math.abs(e), Math.abs(f)),
  )
  const arithmeticPadding = 1024 * Number.EPSILON * condition * sourceMagnitude
  const uncertainty = error * Math.hypot(Math.abs(ia) + Math.abs(ic), Math.abs(ib) + Math.abs(id))
  const padding = region.radius + uncertainty + arithmeticPadding
  if (![condition, sourceMagnitude, arithmeticPadding, uncertainty, padding].every(Number.isFinite))
    return true

  const strokeDirection = {
    x: region.end.x - region.start.x,
    y: region.end.y - region.start.y,
  }
  const queryDirection = { x: queryEnd.x - queryStart.x, y: queryEnd.y - queryStart.y }
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -strokeDirection.y, y: strokeDirection.x },
    { x: -queryDirection.y, y: queryDirection.x },
    ...[region.start, region.end].flatMap((stroke) =>
      local.map((query) => ({ x: query.x - stroke.x, y: query.y - stroke.y })),
    ),
  ]
  for (const axis of axes) {
    const length = Math.hypot(axis.x, axis.y)
    if (!Number.isFinite(length) || length === 0) continue
    const nx = axis.x / length
    const ny = axis.y / length
    const project = (p: PagePoint) => (p.x - region.start.x) * nx + (p.y - region.start.y) * ny
    const strokeEnd = project(region.end)
    const queryFirst = project(queryStart)
    const queryLast = project(queryEnd)
    if (![strokeEnd, queryFirst, queryLast].every(Number.isFinite)) return true
    if (
      Math.min(queryFirst, queryLast) > Math.max(0, strokeEnd) + padding ||
      Math.max(queryFirst, queryLast) < Math.min(0, strokeEnd) - padding
    )
      return false
  }
  return true
}
