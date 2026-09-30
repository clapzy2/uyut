import type { PlanGeometry, PlanOpening, PlanPoint, PlanRoomShape, PlanWall } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { polygonsOverlap } from './plan-page-review'

export type PlanGeometryIssue = {
  id: string
  severity: 'error' | 'warning'
  message: string
  wallIds?: string[]
  openingIds?: string[]
  roomIndexes?: number[]
}

type EditableGeometry = Pick<
  PlanGeometry,
  'widthCm' | 'heightCm' | 'walls' | 'openings' | 'rooms'
> &
  Pick<PlanGeometry, 'pdfCalibration' | 'footprint' | 'voids'>

const ENDPOINT_TOLERANCE_CM = 2
const BODY_CONTACT_TOLERANCE_CM = 0.05
// Real door reveals may be under 20 cm; this is a geometry bound, not a safety clearance.
const MIN_WALL_CM = 1
const MAX_WALL_CM = 5_000

function clippingPolygon(points: readonly PlanPoint[]): Polygon {
  const ring = points.map((point) => [point.xCm, point.yCm] as [number, number])
  const first = ring[0]
  if (!first) throw new Error('Пустой контур нельзя сравнить с границей пола')
  return [[...ring, first]]
}

function clippedAreaCm2(polygons: MultiPolygon): number {
  return polygons.reduce(
    (total, polygon) =>
      total +
      polygon.reduce((area, ring, index) => {
        const ringArea = Math.abs(
          ring.reduce((sum, point, position) => {
            const next = ring[(position + 1) % ring.length]
            if (!next) return sum
            return sum + point[0] * next[1] - next[0] * point[1]
          }, 0) / 2,
        )
        return area + (index === 0 ? ringArea : -ringArea)
      }, 0),
    0,
  )
}

function extendsBeyondFootprint(points: readonly PlanPoint[], footprint: readonly PlanPoint[]) {
  if (points.length < 3 || footprint.length < 3) return false
  return (
    clippedAreaCm2(
      polygonClipping.difference(clippingPolygon(points), clippingPolygon(footprint)),
    ) > 0.01
  )
}

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

function wallBody(wall: PlanWall): PlanPoint[] | undefined {
  if (!wall.thicknessCm || wall.thicknessCm <= 0) return undefined
  const length = distance(wall.start, wall.end)
  if (length === 0) return undefined
  const normalX = ((wall.end.yCm - wall.start.yCm) * wall.thicknessCm) / (2 * length)
  const normalY = ((wall.start.xCm - wall.end.xCm) * wall.thicknessCm) / (2 * length)
  return [
    { xCm: wall.start.xCm + normalX, yCm: wall.start.yCm + normalY },
    { xCm: wall.end.xCm + normalX, yCm: wall.end.yCm + normalY },
    { xCm: wall.end.xCm - normalX, yCm: wall.end.yCm - normalY },
    { xCm: wall.start.xCm - normalX, yCm: wall.start.yCm - normalY },
  ]
}

/** Rectangular measured wall bodies can meet even when their axes stop short of each other. */
function wallBodiesTouch(first: PlanWall, second: PlanWall): boolean {
  const firstBody = wallBody(first)
  const secondBody = wallBody(second)
  if (!firstBody || !secondBody) return false
  for (const body of [firstBody, secondBody]) {
    for (let index = 0; index < body.length; index += 1) {
      const start = body[index]
      const end = body[(index + 1) % body.length]
      if (!start || !end) continue
      const axisX = end.yCm - start.yCm
      const axisY = start.xCm - end.xCm
      const axisLength = Math.hypot(axisX, axisY)
      if (axisLength === 0) continue
      const project = (point: PlanPoint) => (point.xCm * axisX + point.yCm * axisY) / axisLength
      const firstValues = firstBody.map(project)
      const secondValues = secondBody.map(project)
      if (
        Math.max(...firstValues) < Math.min(...secondValues) - BODY_CONTACT_TOLERANCE_CM ||
        Math.max(...secondValues) < Math.min(...firstValues) - BODY_CONTACT_TOLERANCE_CM
      ) {
        return false
      }
    }
  }
  return true
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

function outerEndpointNeighbours(point: PlanPoint, wallId: string, walls: readonly PlanWall[]) {
  return walls.filter(
    (other) =>
      other.id !== wallId &&
      (distance(point, other.start) <= ENDPOINT_TOLERANCE_CM ||
        distance(point, other.end) <= ENDPOINT_TOLERANCE_CM),
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

function polygonCrossesItself(polygon: readonly PlanPoint[]): boolean {
  const count = polygon.length
  for (let first = 0; first < count; first += 1) {
    const firstEnd = (first + 1) % count
    const a = polygon[first]
    const b = polygon[firstEnd]
    if (!a || !b) continue
    for (let second = first + 1; second < count; second += 1) {
      const secondEnd = (second + 1) % count
      if (first === second || firstEnd === second || secondEnd === first) continue
      const c = polygon[second]
      const d = polygon[secondEnd]
      if (c && d && segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function validMetricPolygon(polygon: readonly PlanPoint[], geometry: EditableGeometry): boolean {
  return (
    polygon.length >= 3 &&
    polygon.length <= 200 &&
    polygon.every((point) => pointIsInside(point, geometry)) &&
    polygonAreaM2(polygon) > 0.0001 &&
    !polygonCrossesItself(polygon)
  )
}

function openingInterval(opening: PlanOpening): [number, number] {
  return [opening.offsetCm, opening.offsetCm + opening.widthCm]
}

function collinearOverlapCm(wall: PlanWall, other: PlanWall): number {
  if (
    Math.abs(signedTurn(wall.start, wall.end, other.start)) > 0.001 ||
    Math.abs(signedTurn(wall.start, wall.end, other.end)) > 0.001
  )
    return 0
  const length = distance(wall.start, wall.end)
  if (length === 0) return 0
  const dx = (wall.end.xCm - wall.start.xCm) / length
  const dy = (wall.end.yCm - wall.start.yCm) / length
  const first = (other.start.xCm - wall.start.xCm) * dx + (other.start.yCm - wall.start.yCm) * dy
  const second = (other.end.xCm - wall.start.xCm) * dx + (other.end.yCm - wall.start.yCm) * dy
  return Math.max(
    0,
    Math.min(length, Math.max(first, second)) - Math.max(0, Math.min(first, second)),
  )
}

/** Order an already checked outer ring, retaining the submitted wall endpoints. */
function outerPolygon(walls: readonly PlanWall[]): PlanPoint[] | undefined {
  const first = walls[0]
  if (!first) return undefined
  const points = [first.start, first.end]
  const visited = new Set([first.id])
  let current = first
  let end = first.end
  while (visited.size < walls.length) {
    const next = outerEndpointNeighbours(end, current.id, walls).find(
      (wall) => !visited.has(wall.id),
    )
    if (!next) return undefined
    const forward = distance(end, next.start) <= ENDPOINT_TOLERANCE_CM
    points.push(forward ? next.start : next.end, forward ? next.end : next.start)
    end = forward ? next.end : next.start
    current = next
    visited.add(next.id)
  }
  // Only gaps already accepted by the endpoint check are closed for inspection.
  // This does not move or modify a submitted wall.
  return distance(end, first.start) <= ENDPOINT_TOLERANCE_CM ? points : undefined
}

function pointInPolygon(point: PlanPoint, polygon: readonly PlanPoint[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
    if (onSegment(start, end, point)) return true
    const startAbove = start.yCm > point.yCm
    const endAbove = end.yCm > point.yCm
    if (
      startAbove !== endAbove &&
      point.xCm <
        start.xCm + ((point.yCm - start.yCm) * (end.xCm - start.xCm)) / (end.yCm - start.yCm)
    )
      inside = !inside
  }
  return inside
}

/** Vertices alone miss a room edge that leaves and re-enters a concave outline. */
function edgeInPolygon(start: PlanPoint, end: PlanPoint, polygon: readonly PlanPoint[]): boolean {
  const dx = end.xCm - start.xCm
  const dy = end.yCm - start.yCm
  const squaredLength = dx * dx + dy * dy
  if (squaredLength === 0) return pointInPolygon(start, polygon)
  const cuts = [0, 1]
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    if (!a || !b) continue
    const ex = b.xCm - a.xCm
    const ey = b.yCm - a.yCm
    const ax = a.xCm - start.xCm
    const ay = a.yCm - start.yCm
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) > 0.000001) {
      const alongRoom = (ax * ey - ay * ex) / denominator
      const alongBoundary = (ax * dy - ay * dx) / denominator
      if (
        alongRoom >= -0.000000001 &&
        alongRoom <= 1.000000001 &&
        alongBoundary >= -0.000000001 &&
        alongBoundary <= 1.000000001
      )
        cuts.push(Math.max(0, Math.min(1, alongRoom)))
    } else if (Math.abs(signedTurn(start, end, a)) < 0.001) {
      // Boundary-collinear edges may extend beyond a corner; split at both endpoints.
      for (const point of [a, b]) {
        const position =
          ((point.xCm - start.xCm) * dx + (point.yCm - start.yCm) * dy) / squaredLength
        if (position > 0 && position < 1) cuts.push(position)
      }
    }
  }
  cuts.sort((a, b) => a - b)
  for (let index = 1; index < cuts.length; index += 1) {
    const before = cuts[index - 1]
    const after = cuts[index]
    if (before === undefined || after === undefined || after - before < 0.000000001) continue
    const position = (before + after) / 2
    if (
      !pointInPolygon({ xCm: start.xCm + dx * position, yCm: start.yCm + dy * position }, polygon)
    )
      return false
  }
  return true
}

/** Дополнительные требования к схеме, которую владелец хочет подтвердить. */
export function inspectManualPlanCompleteness(geometry: EditableGeometry): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = []
  if (geometry.pdfCalibration?.derivedOpeningIds.length) {
    issues.push({
      id: 'manual-pdf-opening-measurements',
      severity: 'error',
      message:
        'Сверьте мерки проёмов, перенесённых только по масштабу PDF, перед подтверждением схемы.',
      openingIds: geometry.pdfCalibration.derivedOpeningIds,
    })
  }
  if (geometry.footprint && !validMetricPolygon(geometry.footprint, geometry)) {
    issues.push({
      id: 'manual-footprint-invalid',
      severity: 'error',
      message: 'Внешняя граница пола неполная или пересекает сама себя. Сверьте исходный контур.',
    })
  }
  const voidIds = new Set<string>()
  for (const voidShape of geometry.voids ?? []) {
    if (voidIds.has(voidShape.id) || !validMetricPolygon(voidShape.polygon, geometry)) {
      issues.push({
        id: `manual-void-invalid-${voidShape.id}`,
        severity: 'error',
        message: 'Контур технической пустоты неполный или повторяется. Сверьте исходный план.',
      })
    }
    voidIds.add(voidShape.id)
  }
  const walls = geometry.walls
  for (const [index, room] of geometry.rooms.entries()) {
    const first = room.polygon.map((point) => ({ x: point.xCm, y: point.yCm }))
    for (let otherIndex = index + 1; otherIndex < geometry.rooms.length; otherIndex++) {
      const other = geometry.rooms[otherIndex]
      if (!other) continue
      const second = other.polygon.map((point) => ({ x: point.xCm, y: point.yCm }))
      if (polygonsOverlap(first, second)) {
        issues.push({
          id: `manual-room-overlap-${index}-${otherIndex}`,
          severity: 'error',
          message: `${room.name} и ${other.name}: контуры занимают одну площадь пола. Разделите помещения без наложения.`,
          roomIndexes: [index, otherIndex],
        })
      }
    }
  }
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
          current.thicknessCm && other.thicknessCm
            ? wallBodiesTouch(current, other)
            : distanceToSegment(current.start, other) <= ENDPOINT_TOLERANCE_CM ||
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
    // Anchor diagnostics to the exterior, not the order in which walls were submitted.
    // Several exterior components still fail this gate and the outer-ring checks below.
    const outerIds = new Set(walls.filter((wall) => wall.kind === 'outer').map((wall) => wall.id))
    const rankedGroups = groups
      .map((group) => {
        const ids = [...group].sort()
        const exteriorIds = ids.filter((id) => outerIds.has(id))
        return { ids, exteriorCount: exteriorIds.length, anchorId: exteriorIds[0] ?? ids[0] ?? '' }
      })
      .sort((first, second) => {
        const exteriorDifference = second.exteriorCount - first.exteriorCount
        if (exteriorDifference !== 0) return exteriorDifference
        if (first.exteriorCount === 0 && first.ids.length !== second.ids.length)
          return second.ids.length - first.ids.length
        return first.anchorId < second.anchorId ? -1 : first.anchorId > second.anchorId ? 1 : 0
      })
    issues.push({
      id: 'manual-disconnected-walls',
      severity: 'error',
      message: geometry.pdfCalibration
        ? 'Внутренние и наружные грани перенесены отдельно. Перед подтверждением сопоставьте их с физическими стенами; не соединяйте грани произвольными линиями.'
        : 'Часть стен не соединена с остальной схемой. Сведите их концы или уберите лишние линии.',
      wallIds: rankedGroups
        .slice(1)
        .flatMap((group) => group.ids)
        .sort(),
    })
  }

  const outerWalls = walls.filter((wall) => wall.kind === 'outer')
  if (!geometry.footprint && outerWalls.length === 0) {
    issues.push({
      id: 'manual-missing-outer-walls',
      severity: 'error',
      message: 'Отметьте внешний контур квартиры, прежде чем подтверждать схему.',
    })
  }
  if (!geometry.footprint && outerWalls.length > 0 && outerWalls.length < 3) {
    issues.push({
      id: 'manual-outer-too-few-walls',
      severity: 'error',
      message: 'Внешний контур должен состоять хотя бы из трёх стен.',
      wallIds: outerWalls.map((wall) => wall.id),
    })
  }
  for (const wall of geometry.footprint ? [] : outerWalls) {
    const startNeighbours = outerEndpointNeighbours(wall.start, wall.id, outerWalls)
    const endNeighbours = outerEndpointNeighbours(wall.end, wall.id, outerWalls)
    if (startNeighbours.length === 0 || endNeighbours.length === 0) {
      issues.push({
        id: `manual-outer-gap-${wall.id}`,
        severity: 'error',
        message: 'Концы внешней стены должны совпадать с концами соседних внешних стен.',
        wallIds: [wall.id],
      })
    }
    if (startNeighbours.length > 1 || endNeighbours.length > 1) {
      issues.push({
        id: `manual-outer-branch-${wall.id}`,
        severity: 'error',
        message: 'На внешнем контуре есть разветвление или наложенные стены.',
        wallIds: [wall.id],
      })
    }
  }

  if (!geometry.footprint && outerWalls.length > 0) {
    const connected = new Set([outerWalls[0]?.id])
    const pending = [outerWalls[0]]
    while (pending.length > 0) {
      const wall = pending.pop()
      if (!wall) continue
      for (const point of [wall.start, wall.end]) {
        for (const neighbour of outerEndpointNeighbours(point, wall.id, outerWalls)) {
          if (connected.has(neighbour.id)) continue
          connected.add(neighbour.id)
          pending.push(neighbour)
        }
      }
    }
    if (connected.size !== outerWalls.length) {
      issues.push({
        id: 'manual-outer-disconnected',
        severity: 'error',
        message: 'Внешние стены образуют несколько отдельных контуров.',
        wallIds: outerWalls.filter((wall) => !connected.has(wall.id)).map((wall) => wall.id),
      })
    }
  }

  for (let first = 0; !geometry.footprint && first < outerWalls.length; first += 1) {
    const wall = outerWalls[first]
    if (!wall) continue
    for (let second = first + 1; second < outerWalls.length; second += 1) {
      const other = outerWalls[second]
      if (!other) continue
      const firstSide = signedTurn(wall.start, wall.end, other.start)
      const secondSide = signedTurn(wall.start, wall.end, other.end)
      const thirdSide = signedTurn(other.start, other.end, wall.start)
      const fourthSide = signedTurn(other.start, other.end, wall.end)
      if (firstSide * secondSide < 0 && thirdSide * fourthSide < 0) {
        issues.push({
          id: `manual-outer-cross-${wall.id}-${other.id}`,
          severity: 'error',
          message: 'Внешние стены пересекаются внутри отрезков.',
          wallIds: [wall.id, other.id],
        })
      }
      if (collinearOverlapCm(wall, other) > ENDPOINT_TOLERANCE_CM) {
        issues.push({
          id: `manual-outer-overlap-${wall.id}-${other.id}`,
          severity: 'error',
          message: 'Внешние стены накладываются друг на друга.',
          wallIds: [wall.id, other.id],
        })
      }
    }
  }

  const boundary = geometry.footprint
    ? validMetricPolygon(geometry.footprint, geometry)
      ? geometry.footprint
      : undefined
    : outerWalls.length >= 3 && !issues.some((issue) => issue.id.startsWith('manual-outer-'))
      ? outerPolygon(outerWalls)
      : undefined
  for (const [roomIndex, room] of geometry.rooms.entries()) {
    if (
      boundary &&
      (geometry.footprint
        ? extendsBeyondFootprint(room.polygon, boundary)
        : room.polygon.some((point, index) => {
            const next = room.polygon[(index + 1) % room.polygon.length]
            return (
              !pointInPolygon(point, boundary) || !next || !edgeInPolygon(point, next, boundary)
            )
          }))
    ) {
      issues.push({
        id: `manual-room-outside-outer-${roomIndex}`,
        severity: 'error',
        message: `${room.name}: контур выходит за внешнюю границу квартиры. Проверьте стены и положение комнаты.`,
        roomIndexes: [roomIndex],
      })
    }
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
  for (const [index, voidShape] of (geometry.voids ?? []).entries()) {
    if (!validMetricPolygon(voidShape.polygon, geometry)) continue
    if (
      boundary &&
      (geometry.footprint
        ? extendsBeyondFootprint(voidShape.polygon, boundary)
        : voidShape.polygon.some((point, edgeIndex) => {
            const next = voidShape.polygon[(edgeIndex + 1) % voidShape.polygon.length]
            return (
              !pointInPolygon(point, boundary) || !next || !edgeInPolygon(point, next, boundary)
            )
          }))
    ) {
      issues.push({
        id: `manual-void-outside-${voidShape.id}`,
        severity: 'error',
        message: 'Техническая пустота выходит за проверенную границу пола.',
      })
    }
    const shape = voidShape.polygon.map((point) => ({ x: point.xCm, y: point.yCm }))
    if (
      geometry.rooms.some((room) =>
        polygonsOverlap(
          shape,
          room.polygon.map((point) => ({ x: point.xCm, y: point.yCm })),
        ),
      ) ||
      (geometry.voids ?? []).slice(index + 1).some((other) =>
        polygonsOverlap(
          shape,
          other.polygon.map((point) => ({ x: point.xCm, y: point.yCm })),
        ),
      )
    ) {
      issues.push({
        id: `manual-void-overlap-${voidShape.id}`,
        severity: 'error',
        message: 'Техническая пустота пересекает пол комнаты или другую пустоту.',
      })
    }
  }
  return issues
}

/** Подписанная площадь проверяет контур конкретной комнаты, не только сумму квартиры. */
export function inspectPlanRoomAreas(
  rooms: readonly PlanRoomShape[],
  labels: readonly { name: string; sourceNumber?: number; areaM2?: number }[],
): PlanGeometryIssue[] {
  const labelledAreas = new Map(
    labels
      .filter((label) => label.areaM2 !== undefined && label.areaM2 > 0)
      .map((label) => [label.name.trim().toLocaleLowerCase('ru'), label.areaM2]),
  )
  return rooms.flatMap((room, index) => {
    const members = room.sourceNumbers?.map((number) =>
      labels.filter((label) => label.sourceNumber === number),
    )
    const expected = members
      ? members.every((matches) => matches.length === 1 && matches[0]?.areaM2 !== undefined)
        ? members.flat().reduce((sum, label) => sum + (label.areaM2 ?? 0), 0)
        : undefined
      : labelledAreas.get(room.name.trim().toLocaleLowerCase('ru'))
    if (expected === undefined || room.polygon.length < 3) return []
    const actual = polygonAreaM2(room.polygon)
    if (Math.abs(actual - expected) <= Math.max(0.3, expected * 0.1)) return []
    return [
      {
        id: `manual-room-area-${index}`,
        severity: 'error' as const,
        message: `${room.name}: контур даёт ${actual.toFixed(1)} м², на плане подписано ${expected.toFixed(1)} м². Проверьте границу комнаты.`,
        roomIndexes: [index],
      },
    ]
  })
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
      opening.offsetCm + opening.widthCm > wallLength
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
    } else if (polygonCrossesItself(room.polygon)) {
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
