import type { PlanRoomReading } from '@uyut/db'

export type PageContourPoint = { x: number; y: number }
export type PageContourDraft = {
  roomSourceNumber: number
  polygon: PageContourPoint[]
  closed: boolean
}
export type PlanPagePreview = {
  sha256: string
  page: number
  pageCount: number
  width: number
  height: number
}

export type NativePointCandidate =
  | { kind: 'candidate'; point: PageContourPoint; distance: number }
  | { kind: 'ambiguous' }
  | { kind: 'none' }

/** Original vector vertices only: neither scale nor millimetres are inferred from this snap. */
export function snapPageContourPoint(
  point: PageContourPoint,
  nativePoints: PageContourPoint[],
  page: Pick<PlanPagePreview, 'width' | 'height'>,
): NativePointCandidate {
  if (
    !finiteContourPoint(point) ||
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0
  ) {
    return { kind: 'none' }
  }
  const unique = new Map<string, { point: PageContourPoint; distance: number }>()
  for (const candidate of nativePoints) {
    if (!finiteContourPoint(candidate)) continue
    const distance = Math.hypot(
      ((point.x - candidate.x) * page.width) / 1000,
      ((point.y - candidate.y) * page.height) / 1000,
    )
    if (distance <= 3) {
      unique.set(`${candidate.x}:${candidate.y}`, { point: candidate, distance })
    }
  }
  const candidates = [...unique.values()].sort((left, right) => left.distance - right.distance)
  const first = candidates[0]
  if (!first) return { kind: 'none' }
  // Exact numeric native coordinates are authoritative even beside another drawing feature.
  if (first.distance === 0) return { kind: 'candidate', ...first }
  if (candidates[1] && candidates[1].distance - first.distance <= 0.25) {
    return { kind: 'ambiguous' }
  }
  return { kind: 'candidate', ...first }
}

export function nativeContourPoint(
  point: PageContourPoint,
  nativePoints: PageContourPoint[],
): boolean {
  return nativePoints.some((native) => native.x === point.x && native.y === point.y)
}

export function nativePointsFromResponse(value: unknown): PageContourPoint[] | null {
  if (!value || typeof value !== 'object' || !('points' in value)) return null
  const points = value.points
  if (!Array.isArray(points) || points.length === 0 || points.length > 20_000) return null
  const result: PageContourPoint[] = []
  const seen = new Set<string>()
  for (const point of points) {
    if (
      !point ||
      typeof point !== 'object' ||
      typeof point.x !== 'number' ||
      typeof point.y !== 'number' ||
      !finiteContourPoint(point)
    ) {
      return null
    }
    const key = `${point.x}:${point.y}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ x: point.x, y: point.y })
    }
  }
  return result
}

export function numberedContourRooms(rooms: PlanRoomReading[]): PlanRoomReading[] {
  const counts = new Map<number, number>()
  for (const room of rooms) {
    if (room.sourceNumber !== undefined) {
      counts.set(room.sourceNumber, (counts.get(room.sourceNumber) ?? 0) + 1)
    }
  }
  return rooms.filter(
    (room) =>
      room.sourceNumber !== undefined &&
      Number.isInteger(room.sourceNumber) &&
      room.sourceNumber > 0 &&
      counts.get(room.sourceNumber) === 1,
  )
}

export function pageContourPoint(
  client: PageContourPoint,
  rect: { left: number; top: number; width: number; height: number },
): PageContourPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = ((client.x - rect.left) / rect.width) * 1000
  const y = ((client.y - rect.top) / rect.height) * 1000
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
    return null
  }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}

export function samePlanPage(left: PlanPagePreview, right: PlanPagePreview): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.page === right.page &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function finiteContourPoint(point: PageContourPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1000 &&
    point.y >= 0 &&
    point.y <= 1000
  )
}

export function previewFromHeaders(
  headers: Headers,
  requestedPage: number,
): PlanPagePreview | null {
  const sha256 = headers.get('X-Plan-Sha256') ?? ''
  const page = Number(headers.get('X-Plan-Page'))
  const pageCount = Number(headers.get('X-Plan-Page-Count'))
  const width = Number(headers.get('X-Plan-Page-Width'))
  const height = Number(headers.get('X-Plan-Page-Height'))
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    page !== requestedPage ||
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageCount) ||
    pageCount < page ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null
  }
  return { sha256, page, pageCount, width, height }
}
