import type {
  PlanPageContours,
  PlanPageObstacle,
  PlanPageOpening,
  PlanPageOpeningCheck,
  PlanPageReview,
  PlanPageRoomIdentity,
  PlanRoomReading,
} from '@uyut/db'
import {
  pdfContourIdentity,
  pdfContourKey,
  pdfContourRoomNumbers,
} from '@/lib/projects/plan-pdf-room-binding'

export type PageContourPoint = { x: number; y: number }
export type PageContourDraft = PlanPageRoomIdentity & {
  polygon: PageContourPoint[]
  closed: boolean
  openings?: PageOpeningDraft[]
  obstacles?: PageObstacleDraft[]
}
export type PageOpeningDraft = Omit<PlanPageOpening, 'start' | 'end'> & {
  points: PageContourPoint[]
}
export type PageObstacleDraft = PlanPageObstacle & { closed: boolean }
export type PageContourTarget =
  | { kind: 'room' }
  | { kind: 'opening'; id: string }
  | { kind: 'obstacle'; id: string }

export function contourDraftsFromSaved(rooms: PlanPageContours['rooms']): PageContourDraft[] {
  return rooms.map((room) => ({
    ...pdfContourIdentity(room),
    polygon: room.polygon.map((point) => ({ ...point })),
    closed: true,
    openings: room.openings?.map(({ start, end, ...opening }) => ({
      ...opening,
      points: [{ ...start }, { ...end }],
    })),
    obstacles: room.obstacles?.map((obstacle) => ({
      ...obstacle,
      polygon: obstacle.polygon.map((point) => ({ ...point })),
      closed: true,
    })),
  }))
}

/** Incomplete feature drafts never disappear silently from a save request. */
export function pageContourRoomsForSave(
  drafts: PageContourDraft[],
  nativePoints: PageContourPoint[],
): PlanPageContours['rooms'] | null {
  if (!drafts.length || drafts.length > 100) return null
  const valid = (points: PageContourPoint[], minimum: number) =>
    points.length >= minimum &&
    points.length <= 100 &&
    points.every((point) => finiteContourPoint(point) && nativeContourPoint(point, nativePoints))
  const rooms: PlanPageContours['rooms'] = []
  const claimed = new Set<number>()
  for (const draft of drafts) {
    const numbers = pdfContourRoomNumbers(draft)
    if (
      numbers.length === 0 ||
      numbers.length > 12 ||
      (draft.roomSourceNumbers !== undefined && numbers.length < 2) ||
      numbers.some(
        (number) =>
          !Number.isInteger(number) || number < 1 || number > 10_000 || claimed.has(number),
      ) ||
      new Set(numbers).size !== numbers.length
    )
      return null
    for (const number of numbers) claimed.add(number)
    if (!draft.closed || !valid(draft.polygon, 3)) return null
    if ((draft.openings?.length ?? 0) > 32 || (draft.obstacles?.length ?? 0) > 20) return null
    const openings: PlanPageOpening[] = []
    for (const { points, ...opening } of draft.openings ?? []) {
      if (points.length !== 2 || !valid(points, 2)) return null
      const [start, end] = points
      if (!start || !end) return null
      openings.push({ ...opening, start: { ...start }, end: { ...end } })
    }
    const obstacles: PlanPageObstacle[] = []
    for (const { closed, ...obstacle } of draft.obstacles ?? []) {
      if (!closed || !valid(obstacle.polygon, 3)) return null
      obstacles.push({ ...obstacle, polygon: obstacle.polygon.map((point) => ({ ...point })) })
    }
    rooms.push({
      ...pdfContourIdentity(draft),
      polygon: draft.polygon.map((point) => ({ ...point })),
      ...(openings.length ? { openings } : {}),
      ...(obstacles.length ? { obstacles } : {}),
    })
  }
  return rooms
}

export function pageContourOptions(rooms: PlanRoomReading[], drafts: PageContourDraft[]) {
  const eligible = numberedContourRooms(rooms)
  const groups = drafts.filter((draft) => draft.roomSourceNumbers !== undefined)
  const groupedNumbers = new Set(groups.flatMap((group) => [...pdfContourRoomNumbers(group)]))
  const identities: PlanPageRoomIdentity[] = [
    ...groups.map(pdfContourIdentity),
    ...eligible
      .filter((room) => !groupedNumbers.has(room.sourceNumber as number))
      .map((room) => ({ roomSourceNumber: room.sourceNumber as number })),
  ]
  return identities.map((identity) => {
    const numbers = pdfContourRoomNumbers(identity)
    const names = numbers.map(
      (number) => eligible.find((room) => room.sourceNumber === number)?.name,
    )
    return {
      identity,
      key: pdfContourKey(identity),
      label: `№ ${numbers.join(' + ')} · ${numbers.length > 1 ? 'Общая зона' : names[0]}`,
    }
  })
}

/** Group only explicitly selected source numbers; never merge two drawn physical shapes. */
export function groupPageContourDraft(
  drafts: PageContourDraft[],
  selected: PlanPageRoomIdentity,
  otherNumber: number,
  rooms: PlanRoomReading[],
): PageContourDraft[] | null {
  if (selected.roomSourceNumbers !== undefined) return null
  const eligible = new Set(numberedContourRooms(rooms).map((room) => room.sourceNumber))
  const selectedNumber = selected.roomSourceNumber
  if (!eligible.has(selectedNumber) || !eligible.has(otherNumber) || selectedNumber === otherNumber)
    return null
  if (
    drafts.some(
      (draft) =>
        pdfContourKey(draft) !== pdfContourKey(selected) &&
        pdfContourRoomNumbers(draft).some(
          (number) => number === selectedNumber || number === otherNumber,
        ),
    )
  )
    return null
  const before = drafts.find((draft) => pdfContourKey(draft) === pdfContourKey(selected))
  const grouped: PageContourDraft = {
    roomSourceNumbers: [selectedNumber, otherNumber].sort((a, b) => a - b),
    polygon: before?.polygon.map((point) => ({ ...point })) ?? [],
    closed: before?.closed ?? false,
    ...(before?.openings ? { openings: before.openings } : {}),
    ...(before?.obstacles ? { obstacles: before.obstacles } : {}),
  }
  return [...drafts.filter((draft) => pdfContourKey(draft) !== pdfContourKey(selected)), grouped]
}

export function canAddPageFeature(
  draft: PageContourDraft | undefined,
  kind: 'door' | 'window' | 'balcony' | 'shaft' | 'column' | 'fixed',
): boolean {
  if (!draft?.closed) return false
  return kind === 'door' || kind === 'window' || kind === 'balcony'
    ? (draft.openings?.length ?? 0) < 32
    : (draft.obstacles?.length ?? 0) < 20
}

/** A displayed width belongs only to the unchanged source annotation, never an edited draft. */
export function savedPageOpeningCheck(
  review: PlanPageReview | undefined,
  draft: PageContourDraft | undefined,
  opening: PageOpeningDraft | undefined,
  preview: PlanPagePreview | undefined,
): PlanPageOpeningCheck | undefined {
  if (!review || !draft || !opening || !preview) return undefined
  const source = review.contours
  if (
    !samePlanPage(preview, {
      sha256: source.source.sha256,
      page: source.source.pdfPage,
      pageCount: preview.pageCount,
      width: source.pageWidth,
      height: source.pageHeight,
    })
  )
    return undefined
  const savedRoom = source.rooms.find((room) => pdfContourKey(room) === pdfContourKey(draft))
  const saved = savedRoom?.openings?.find((item) => item.id === opening.id)
  const samePoints = (left: PageContourPoint[], right: PageContourPoint[]) =>
    left.length === right.length &&
    left.every((point, index) => point.x === right[index]?.x && point.y === right[index]?.y)
  if (
    !saved ||
    !savedRoom ||
    saved.kind !== opening.kind ||
    saved.wallEdgeIndex !== opening.wallEdgeIndex ||
    !samePoints(opening.points, [saved.start, saved.end]) ||
    !samePoints(draft.polygon, savedRoom.polygon)
  )
    return undefined
  return review.featureChecks?.openings.find(
    (check) => pdfContourKey(check) === pdfContourKey(draft) && check.openingId === opening.id,
  )
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
