import type {
  PlanPageContours,
  PlanPageEndpointProof,
  PlanPageObstacle,
  PlanPageOpening,
  PlanPageOpeningCheck,
  PlanPageReview,
  PlanPageRoomIdentity,
  PlanRoomReading,
} from '@uyut/db'
import { sourceRoomContourVertices } from '@/lib/projects/plan-page-review'
import {
  type NativePageSegment,
  nativeEdgeCrossing,
  sourceOpeningEndpoint,
} from '@/lib/projects/plan-pdf-opening-endpoint'
import {
  pdfContourIdentity,
  pdfContourKey,
  pdfContourRoomNumbers,
} from '@/lib/projects/plan-pdf-room-binding'

export type PageContourPoint = { x: number; y: number }
export type PageContourDraft = PlanPageRoomIdentity & {
  polygon: PageContourPoint[]
  closed: boolean
  conditionalEdges?: PlanPageContours['rooms'][number]['conditionalEdges']
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
    ...(room.conditionalEdges ? { conditionalEdges: structuredClone(room.conditionalEdges) } : {}),
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
  segments: readonly NativePageSegment[] = [],
): PlanPageContours['rooms'] | null {
  if (!drafts.length || drafts.length > 100) return null
  const valid = (points: PageContourPoint[], minimum: number) =>
    points.length >= minimum &&
    points.length <= 100 &&
    points.every((point) => finiteContourPoint(point) && nativeContourPoint(point, nativePoints))
  const rooms: PlanPageContours['rooms'] = []
  const nativeSet = new Set(nativePoints.map((p) => `${p.x}:${p.y}`))
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
    if (
      !draft.closed ||
      draft.polygon.length < 3 ||
      draft.polygon.length > 100 ||
      !draft.polygon.every(finiteContourPoint) ||
      !sourceRoomContourVertices(draft, nativeSet, segments)
    )
      return null
    if ((draft.openings?.length ?? 0) > 32 || (draft.obstacles?.length ?? 0) > 20) return null
    const openings: PlanPageOpening[] = []
    for (const { points, ...opening } of draft.openings ?? []) {
      if (points.length !== 2 || !points.every(finiteContourPoint)) return null
      const [start, end] = points
      const a = draft.polygon[opening.wallEdgeIndex]
      const b = draft.polygon[(opening.wallEdgeIndex + 1) % draft.polygon.length]
      if (
        !start ||
        !end ||
        !a ||
        !b ||
        draft.conditionalEdges?.some((edge) => edge.wallEdgeIndex === opening.wallEdgeIndex) ||
        !sourceOpeningEndpoint(start, opening.endpointProofs?.start, [a, b], nativeSet, segments) ||
        !sourceOpeningEndpoint(end, opening.endpointProofs?.end, [a, b], nativeSet, segments)
      )
        return null
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
      ...(draft.conditionalEdges?.length
        ? { conditionalEdges: structuredClone(draft.conditionalEdges) }
        : {}),
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
    ...(before?.conditionalEdges ? { conditionalEdges: before.conditionalEdges } : {}),
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
    JSON.stringify(saved.endpointProofs) !== JSON.stringify(opening.endpointProofs) ||
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
  | { kind: 'candidate'; point: PageContourPoint; distance: number; proof?: PlanPageEndpointProof }
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

/** Endpoint crossings are available only for a declared, locked room edge. */
export function snapPageOpeningPoint(
  point: PageContourPoint,
  nativePoints: PageContourPoint[],
  page: Pick<PlanPagePreview, 'width' | 'height'>,
  edge: readonly [PageContourPoint, PageContourPoint],
  segments: readonly NativePageSegment[],
): NativePointCandidate {
  const native = snapPageContourPoint(point, nativePoints, page)
  if (native.kind === 'candidate' && native.distance === 0) return native
  if (
    !finiteContourPoint(point) ||
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0
  )
    return { kind: 'none' }
  const crossings = new Map<
    string,
    { point: PageContourPoint; distance: number; proof: PlanPageEndpointProof }
  >()
  const nativeKeys = new Set(nativePoints.map((p) => `${p.x}:${p.y}`))
  for (const segment of segments) {
    const crossing = nativeEdgeCrossing(edge, segment)
    if (!crossing) continue
    const distance = Math.hypot(
      ((point.x - crossing.x) * page.width) / 1000,
      ((point.y - crossing.y) * page.height) / 1000,
    )
    const key = `${crossing.x}:${crossing.y}`
    if (distance > 3 || nativeKeys.has(key) || crossings.has(key)) continue
    // Coincident strokes prove the same coordinate, not alternative point locations.
    crossings.set(key, {
      point: crossing,
      distance,
      proof: {
        kind: 'native-edge-crossing',
        operationIndex: segment.operationIndex,
        subpathIndex: segment.subpathIndex,
        segmentIndex: segment.segmentIndex,
      },
    })
  }
  if (!crossings.size) return native
  const candidates = [...crossings.values(), ...(native.kind === 'candidate' ? [native] : [])].sort(
    (a, b) => a.distance - b.distance,
  )
  const first = candidates[0]
  if (!first) return native
  if (
    first.distance !== 0 &&
    (native.kind === 'ambiguous' ||
      (candidates[1] && candidates[1].distance - first.distance <= 0.25))
  )
    return { kind: 'ambiguous' }
  return { ...first, kind: 'candidate' }
}

/** Preserve a proof only for its unchanged endpoint; moving/undoing must not reuse it. */
export function pageOpeningPointsChanged(
  opening: PageOpeningDraft,
  points: PageContourPoint[],
  replacement?: { index: number; proof?: PlanPageEndpointProof },
): PageOpeningDraft {
  const endpointProofs: NonNullable<PlanPageOpening['endpointProofs']> = {}
  for (const [index, key] of [
    [0, 'start'],
    [1, 'end'],
  ] as const) {
    if (!points[index]) continue
    const before = opening.points[index]
    const proof =
      replacement?.index === index
        ? replacement.proof
        : before && before.x === points[index].x && before.y === points[index].y
          ? opening.endpointProofs?.[key]
          : undefined
    if (proof) endpointProofs[key] = proof
  }
  const { endpointProofs: _beforeProofs, ...rest } = opening
  return { ...rest, points, ...(Object.keys(endpointProofs).length ? { endpointProofs } : {}) }
}

export function nativeSegmentsFromResponse(value: unknown): NativePageSegment[] | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('segments' in value) ||
    !Array.isArray(value.segments) ||
    value.segments.length > 20_000
  )
    return null
  const segments: NativePageSegment[] = []
  const keys = new Set<string>()
  for (const raw of value.segments) {
    if (!raw || typeof raw !== 'object') return null
    const { operationIndex, subpathIndex, segmentIndex, start, end } = raw
    if (
      ![operationIndex, subpathIndex, segmentIndex].every(
        (n) => Number.isSafeInteger(n) && n >= 0 && n < 100_000,
      ) ||
      !start ||
      !end ||
      !finiteContourPoint(start) ||
      !finiteContourPoint(end)
    )
      return null
    const key = `${operationIndex}:${subpathIndex}:${segmentIndex}`
    if (keys.has(key)) return null
    keys.add(key)
    segments.push({
      operationIndex,
      subpathIndex,
      segmentIndex,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    })
  }
  return segments
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
