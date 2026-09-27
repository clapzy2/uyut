import type { PagePoint, PdfLinework } from './plan-pdf-linework'

export type PdfPlanSource = { sha256: string; pdfPage: number; state: 'existing' | 'proposed' }
export type PdfRoomContour = { roomSourceNumber: number; polygon: PagePoint[] }
export type PdfRoomContours = {
  source: PdfPlanSource
  coordinateSystem: 'page-0-1000'
  review: 'manual-source-review'
  pageWidth: number
  pageHeight: number
  rooms: PdfRoomContour[]
}
export type PdfRoomBinding =
  | { status: 'candidate'; roomSourceNumber: number; basis: 'manual-page-contour' }
  | { status: 'unresolved' | 'ambiguous'; roomSourceNumber: null; reason: string }

export function pdfPointDistance(
  work: Pick<PdfLinework, 'pageWidth' | 'pageHeight'>,
  a: PagePoint,
  b: PagePoint,
): number {
  return Math.hypot(((a.x - b.x) * work.pageWidth) / 1000, ((a.y - b.y) * work.pageHeight) / 1000)
}

export function pdfBoundaryDistance(
  work: Pick<PdfLinework, 'pageWidth' | 'pageHeight'>,
  point: PagePoint,
  polygon: readonly PagePoint[],
): number {
  const scaled = (p: PagePoint) => ({
    x: (p.x * work.pageWidth) / 1000,
    y: (p.y * work.pageHeight) / 1000,
  })
  const p = scaled(point)
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]
    const end = polygon[(i + 1) % polygon.length]
    if (!start || !end) continue
    const a = scaled(start)
    const b = scaled(end)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = dx * dx + dy * dy
    const ratio =
      length > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
    nearest = Math.min(nearest, Math.hypot(p.x - a.x - dx * ratio, p.y - a.y - dy * ratio))
  }
  return nearest
}

export function pdfPointInside(point: PagePoint, polygon: readonly PagePoint[]): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b) continue
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      inside = !inside
  }
  return inside
}

const pagePoint = (p: PagePoint) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 1000
const turn = (a: PagePoint, b: PagePoint, c: PagePoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

function segmentsTouch(a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint): boolean {
  const on = (p: PagePoint, q: PagePoint, r: PagePoint) =>
    Math.abs(turn(p, q, r)) < 0.000001 &&
    r.x >= Math.min(p.x, q.x) &&
    r.x <= Math.max(p.x, q.x) &&
    r.y >= Math.min(p.y, q.y) &&
    r.y <= Math.max(p.y, q.y)
  return (
    (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  )
}

function validPolygon(points: readonly PagePoint[]): boolean {
  if (points.length < 3 || points.length > 100 || points.some((point) => !pagePoint(point)))
    return false
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!a || !b || points.slice(i + 1).some((p) => p.x === a.x && p.y === a.y)) return false
    area += a.x * b.y - b.x * a.y
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      const c = points[j]
      const d = points[(j + 1) % points.length]
      if (c && d && segmentsTouch(a, b, c, d)) return false
    }
  }
  return Math.abs(area) > 0.001
}

/** Validate the source and coordinate space before considering a hand-reviewed page contour. */
export function pdfContourIssue(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
): string | undefined {
  if (work.truncated || work.unsupportedContexts > 0 || work.unsupportedPaths > 0)
    return 'incomplete-vector-layer'
  if (
    work.coordinateSystem !== 'page-0-1000' ||
    contours.coordinateSystem !== 'page-0-1000' ||
    contours.review !== 'manual-source-review'
  )
    return 'unreviewed-coordinate-space'
  if (
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.pdfPage) ||
    source.pdfPage < 1 ||
    !['existing', 'proposed'].includes(source.state) ||
    source.sha256 !== contours.source.sha256 ||
    source.pdfPage !== contours.source.pdfPage ||
    source.state !== contours.source.state
  )
    return 'different-plan-source'
  if (
    ![work.pageWidth, work.pageHeight].every((v) => Number.isFinite(v) && v > 0) ||
    work.pageWidth !== contours.pageWidth ||
    work.pageHeight !== contours.pageHeight
  )
    return 'different-page-format'
  const numbers = new Set<number>()
  if (contours.rooms.length > 100) return 'invalid-room-contours'
  for (const room of contours.rooms) {
    if (
      !Number.isSafeInteger(room.roomSourceNumber) ||
      room.roomSourceNumber < 1 ||
      numbers.has(room.roomSourceNumber) ||
      !validPolygon(room.polygon)
    )
      return 'invalid-room-contours'
    numbers.add(room.roomSourceNumber)
  }
  return undefined
}

/** This is candidate ownership against manual annotation, not automatic wall recognition. */
export function pdfRoomAtPoint(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  point: PagePoint,
): PdfRoomBinding {
  const issue = pdfContourIssue(work, source, contours)
  if (issue || !pagePoint(point))
    return { status: 'unresolved', roomSourceNumber: null, reason: issue ?? 'invalid-page-point' }
  if (contours.rooms.some((room) => pdfBoundaryDistance(work, point, room.polygon) <= 0.5))
    return { status: 'ambiguous', roomSourceNumber: null, reason: 'point-near-room-boundary' }
  const owners = contours.rooms.filter((room) => pdfPointInside(point, room.polygon))
  if (owners.length !== 1)
    return {
      status: owners.length > 1 ? 'ambiguous' : 'unresolved',
      roomSourceNumber: null,
      reason: owners.length > 1 ? 'overlapping-room-contours' : 'no-annotated-room',
    }
  const owner = owners[0]
  if (!owner) return { status: 'unresolved', roomSourceNumber: null, reason: 'no-annotated-room' }
  return {
    status: 'candidate',
    roomSourceNumber: owner.roomSourceNumber,
    basis: 'manual-page-contour',
  }
}
