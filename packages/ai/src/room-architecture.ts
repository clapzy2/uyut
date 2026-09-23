import type { PlanGeometry, PlanPoint } from '@uyut/db'

export type RoomArchitecture = {
  shape: 'rectangular' | 'nonrectangular'
  openings: Array<{
    type: 'door' | 'window' | 'balcony'
    side: 'top' | 'right' | 'bottom' | 'left' | 'inner'
  }>
}

const BOUNDARY_TOLERANCE_CM = 20

function distanceToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint): number {
  const dx = end.xCm - start.xCm
  const dy = end.yCm - start.yCm
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.xCm - start.xCm, point.yCm - start.yCm)
  const position = Math.max(
    0,
    Math.min(1, ((point.xCm - start.xCm) * dx + (point.yCm - start.yCm) * dy) / lengthSquared),
  )
  return Math.hypot(point.xCm - start.xCm - dx * position, point.yCm - start.yCm - dy * position)
}

function onRoomBoundary(start: PlanPoint, end: PlanPoint, polygon: PlanPoint[]): boolean {
  return polygon.some((edgeStart, index) => {
    const edgeEnd = polygon[(index + 1) % polygon.length]
    return (
      edgeEnd !== undefined &&
      distanceToSegment(start, edgeStart, edgeEnd) <= BOUNDARY_TOLERANCE_CM &&
      distanceToSegment(end, edgeStart, edgeEnd) <= BOUNDARY_TOLERANCE_CM
    )
  })
}

function openingSide(
  start: PlanPoint,
  end: PlanPoint,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): RoomArchitecture['openings'][number]['side'] {
  if (
    Math.abs(start.yCm - bounds.minY) <= BOUNDARY_TOLERANCE_CM &&
    Math.abs(end.yCm - bounds.minY) <= BOUNDARY_TOLERANCE_CM
  )
    return 'top'
  if (
    Math.abs(start.xCm - bounds.maxX) <= BOUNDARY_TOLERANCE_CM &&
    Math.abs(end.xCm - bounds.maxX) <= BOUNDARY_TOLERANCE_CM
  )
    return 'right'
  if (
    Math.abs(start.yCm - bounds.maxY) <= BOUNDARY_TOLERANCE_CM &&
    Math.abs(end.yCm - bounds.maxY) <= BOUNDARY_TOLERANCE_CM
  )
    return 'bottom'
  if (
    Math.abs(start.xCm - bounds.minX) <= BOUNDARY_TOLERANCE_CM &&
    Math.abs(end.xCm - bounds.minX) <= BOUNDARY_TOLERANCE_CM
  )
    return 'left'
  return 'inner'
}

/** Facts are available only for a uniquely matched room in a confirmed plan. */
export function roomArchitectureFromPlan(
  geometry: PlanGeometry | undefined,
  roomName: string,
): RoomArchitecture | null {
  if (geometry?.status !== 'confirmed') return null
  const normalizedName = roomName.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
  const matches = geometry.rooms.filter(
    (room) => room.name.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е') === normalizedName,
  )
  const room = matches.length === 1 ? matches[0] : undefined
  if (!room || room.polygon.length < 3) return null

  const xs = room.polygon.map((point) => point.xCm)
  const ys = room.polygon.map((point) => point.yCm)
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
  const corners = new Set([
    `${bounds.minX},${bounds.minY}`,
    `${bounds.maxX},${bounds.minY}`,
    `${bounds.maxX},${bounds.maxY}`,
    `${bounds.minX},${bounds.maxY}`,
  ])
  const rectangular =
    room.polygon.length === 4 &&
    room.polygon.every((point) => corners.has(`${point.xCm},${point.yCm}`))

  const walls = new Map(geometry.walls.map((wall) => [wall.id, wall]))
  const openings: RoomArchitecture['openings'] = []
  for (const opening of geometry.openings) {
    const wall = walls.get(opening.wallId)
    if (!wall) continue
    const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
    if (length <= 0 || opening.offsetCm < 0 || opening.offsetCm + opening.widthCm > length) continue
    const alongWall = (distanceCm: number): PlanPoint => ({
      xCm: wall.start.xCm + ((wall.end.xCm - wall.start.xCm) * distanceCm) / length,
      yCm: wall.start.yCm + ((wall.end.yCm - wall.start.yCm) * distanceCm) / length,
    })
    const start = alongWall(opening.offsetCm)
    const end = alongWall(opening.offsetCm + opening.widthCm)
    if (!onRoomBoundary(start, end, room.polygon)) continue
    openings.push({ type: opening.type, side: openingSide(start, end, bounds) })
  }

  return { shape: rectangular ? 'rectangular' : 'nonrectangular', openings }
}
