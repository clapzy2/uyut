import type { PlanGeometry, PlanOpening, PlanPoint, PlanRoomShape, PlanWall } from '@uyut/db'

export type PlanGeometryIssue = {
  id: string
  severity: 'error' | 'warning'
  message: string
  wallIds?: string[]
  openingIds?: string[]
  roomIndexes?: number[]
}

type EditableGeometry = Pick<PlanGeometry, 'widthCm' | 'heightCm' | 'walls' | 'openings' | 'rooms'>

const ENDPOINT_TOLERANCE_CM = 2
const MIN_WALL_CM = 20
const MAX_WALL_CM = 5_000

function distance(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.xCm - a.xCm, b.yCm - a.yCm)
}

function pointIsFinite(point: PlanPoint): boolean {
  return Number.isFinite(point.xCm) && Number.isFinite(point.yCm)
}

function pointIsInside(point: PlanPoint, geometry: EditableGeometry): boolean {
  return (
    pointIsFinite(point) &&
    point.xCm >= 0 &&
    point.yCm >= 0 &&
    point.xCm <= geometry.widthCm &&
    point.yCm <= geometry.heightCm
  )
}

function polygonAreaM2(points: readonly PlanPoint[]): number {
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (current && next) twiceArea += current.xCm * next.yCm - next.xCm * current.yCm
  }
  return Math.abs(twiceArea) / 2 / 10_000
}

function distanceToSegment(point: PlanPoint, wall: PlanWall): number {
  const dx = wall.end.xCm - wall.start.xCm
  const dy = wall.end.yCm - wall.start.yCm
  const squaredLength = dx * dx + dy * dy
  if (squaredLength === 0) return distance(point, wall.start)
  const position = Math.max(
    0,
    Math.min(
      1,
      ((point.xCm - wall.start.xCm) * dx + (point.yCm - wall.start.yCm) * dy) / squaredLength,
    ),
  )
  return distance(point, {
    xCm: wall.start.xCm + dx * position,
    yCm: wall.start.yCm + dy * position,
  })
}

function endpointIsConnected(
  point: PlanPoint,
  wallId: string,
  walls: readonly PlanWall[],
): boolean {
  return walls.some(
    (other) => other.id !== wallId && distanceToSegment(point, other) <= ENDPOINT_TOLERANCE_CM,
  )
}

function signedTurn(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b.xCm - a.xCm) * (c.yCm - a.yCm) - (b.yCm - a.yCm) * (c.xCm - a.xCm)
}

function onSegment(a: PlanPoint, b: PlanPoint, point: PlanPoint): boolean {
  return (
    Math.abs(signedTurn(a, b, point)) < 0.001 &&
    point.xCm >= Math.min(a.xCm, b.xCm) &&
    point.xCm <= Math.max(a.xCm, b.xCm) &&
    point.yCm >= Math.min(a.yCm, b.yCm) &&
    point.yCm <= Math.max(a.yCm, b.yCm)
  )
}

function segmentsIntersect(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const abC = signedTurn(a, b, c)
  const abD = signedTurn(a, b, d)
  const cdA = signedTurn(c, d, a)
  const cdB = signedTurn(c, d, b)
  const abSeparated = (abC > 0 && abD < 0) || (abC < 0 && abD > 0)
  const cdSeparated = (cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0)
  if (abSeparated && cdSeparated) return true
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

function roomCrossesItself(room: PlanRoomShape): boolean {
  const count = room.polygon.length
  for (let first = 0; first < count; first += 1) {
    const firstEnd = (first + 1) % count
    const a = room.polygon[first]
    const b = room.polygon[firstEnd]
    if (!a || !b) continue
    for (let second = first + 1; second < count; second += 1) {
      const secondEnd = (second + 1) % count
      if (first === second || firstEnd === second || secondEnd === first) continue
      const c = room.polygon[second]
      const d = room.polygon[secondEnd]
      if (c && d && segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function openingInterval(opening: PlanOpening): [number, number] {
  return [opening.offsetCm, opening.offsetCm + opening.widthCm]
}

/** Дополнительные требования к схеме, которую владелец хочет подтвердить. */
export function inspectManualPlanCompleteness(geometry: EditableGeometry): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = []
  const walls = geometry.walls
  if (walls.length === 0) return issues

  const visited = new Set<string>()
  const groups: string[][] = []
  for (const wall of walls) {
    if (visited.has(wall.id)) continue
    const group: string[] = []
    const pending = [wall]
    visited.add(wall.id)
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue
      group.push(current.id)
      for (const other of walls) {
        if (visited.has(other.id)) continue
        const touches =
          distanceToSegment(current.start, other) <= ENDPOINT_TOLERANCE_CM ||
          distanceToSegment(current.end, other) <= ENDPOINT_TOLERANCE_CM ||
          distanceToSegment(other.start, current) <= ENDPOINT_TOLERANCE_CM ||
          distanceToSegment(other.end, current) <= ENDPOINT_TOLERANCE_CM ||
          segmentsIntersect(current.start, current.end, other.start, other.end)
        if (touches) {
          visited.add(other.id)
          pending.push(other)
        }
      }
    }
    groups.push(group)
  }
  if (groups.length > 1) {
    issues.push({
      id: 'manual-disconnected-walls',
      severity: 'error',
      message:
        'Часть стен не соединена с остальной схемой. Сведите их концы или уберите лишние линии.',
      wallIds: groups.slice(1).flat(),
    })
  }

  const outerWalls = walls.filter((wall) => wall.kind === 'outer')
  if (outerWalls.length === 0) {
    issues.push({
      id: 'manual-missing-outer-walls',
      severity: 'error',
      message: 'Отметьте внешний контур квартиры, прежде чем подтверждать схему.',
    })
  }
  for (const wall of outerWalls) {
    if (
      !endpointIsConnected(wall.start, wall.id, outerWalls) ||
      !endpointIsConnected(wall.end, wall.id, outerWalls)
    ) {
      issues.push({
        id: `manual-outer-gap-${wall.id}`,
        severity: 'error',
        message: 'Внешний контур должен быть замкнут внешними стенами.',
        wallIds: [wall.id],
      })
    }
  }

  for (const [roomIndex, room] of geometry.rooms.entries()) {
    const nearWall = room.polygon.some((point) =>
      walls.some((wall) => distanceToSegment(point, wall) <= 20),
    )
    if (!nearWall) {
      issues.push({
        id: `manual-detached-room-${roomIndex}`,
        severity: 'error',
        message: `${room.name}: контур не касается ни одной нанесённой стены. Проверьте положение комнаты.`,
        roomIndexes: [roomIndex],
      })
    }
  }
  return issues
}

/** Быстрая проверка правок до отправки схемы на сервер. */
export function inspectPlanGeometry(geometry: EditableGeometry): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = []
  const wallById = new Map(geometry.walls.map((wall) => [wall.id, wall]))

  for (const [index, wall] of geometry.walls.entries()) {
    const label = `Стена ${index + 1}`
    if (!pointIsInside(wall.start, geometry) || !pointIsInside(wall.end, geometry)) {
      issues.push({
        id: `wall-bounds-${wall.id}`,
        severity: 'error',
        message: `${label} вышла за границы плана.`,
        wallIds: [wall.id],
      })
      continue
    }
    const wallLength = distance(wall.start, wall.end)
    if (wallLength < MIN_WALL_CM || wallLength > MAX_WALL_CM) {
      issues.push({
        id: `wall-short-${wall.id}`,
        severity: 'error',
        message:
          wallLength < MIN_WALL_CM
            ? `${label} короче ${MIN_WALL_CM} см.`
            : `${label} длиннее ${MAX_WALL_CM} см. Проверьте масштаб.`,
        wallIds: [wall.id],
      })
    }
    if (
      wall.kind === 'outer' &&
      (!endpointIsConnected(wall.start, wall.id, geometry.walls) ||
        !endpointIsConnected(wall.end, wall.id, geometry.walls))
    ) {
      issues.push({
        id: `wall-gap-${wall.id}`,
        severity: 'warning',
        message: `${label}: внешний контур разомкнут. Сведите отмеченные концы стен.`,
        wallIds: [wall.id],
      })
    }
  }

  for (const [index, opening] of geometry.openings.entries()) {
    const wall = wallById.get(opening.wallId)
    const label = `${opening.type === 'window' ? 'Окно' : opening.type === 'balcony' ? 'Балконный блок' : 'Дверь'} ${index + 1}`
    const wallLength = wall ? distance(wall.start, wall.end) : 0
    if (
      !wall ||
      !Number.isFinite(opening.offsetCm) ||
      !Number.isFinite(opening.widthCm) ||
      opening.offsetCm < 0 ||
      opening.widthCm < 30 ||
      opening.widthCm > 1_000 ||
      opening.offsetCm + opening.widthCm > wallLength ||
      wallLength - opening.widthCm < 30
    ) {
      issues.push({
        id: `opening-bounds-${opening.id}`,
        severity: 'error',
        message: `${label} не помещается на выбранной стене.`,
        ...(wall ? { wallIds: [wall.id] } : {}),
        openingIds: [opening.id],
      })
    }
  }

  for (let first = 0; first < geometry.openings.length; first += 1) {
    const opening = geometry.openings[first]
    if (!opening) continue
    const [firstStart, firstEnd] = openingInterval(opening)
    for (let second = first + 1; second < geometry.openings.length; second += 1) {
      const other = geometry.openings[second]
      if (!other || opening.wallId !== other.wallId) continue
      const [secondStart, secondEnd] = openingInterval(other)
      if (Math.max(firstStart, secondStart) < Math.min(firstEnd, secondEnd)) {
        issues.push({
          id: `opening-overlap-${opening.id}-${other.id}`,
          severity: 'error',
          message: `Два проёма на одной стене пересекаются.`,
          wallIds: [opening.wallId],
          openingIds: [opening.id, other.id],
        })
      }
    }
  }

  for (const [roomIndex, room] of geometry.rooms.entries()) {
    if (room.polygon.some((point) => !pointIsInside(point, geometry))) {
      issues.push({
        id: `room-bounds-${roomIndex}`,
        severity: 'error',
        message: `${room.name}: точка контура вышла за границы плана.`,
        roomIndexes: [roomIndex],
      })
    } else if (roomCrossesItself(room)) {
      issues.push({
        id: `room-cross-${roomIndex}`,
        severity: 'error',
        message: `${room.name}: линии контура пересекаются.`,
        roomIndexes: [roomIndex],
      })
    } else if (room.polygon.length < 3 || polygonAreaM2(room.polygon) < 0.5) {
      issues.push({
        id: `room-area-${roomIndex}`,
        severity: 'error',
        message: `${room.name}: контур не образует комнату площадью хотя бы 0,5 м².`,
        roomIndexes: [roomIndex],
      })
    }
  }

  return issues
}
