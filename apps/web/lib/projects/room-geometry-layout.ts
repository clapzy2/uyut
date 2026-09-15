import type { RoomLayoutInput, WallReservation } from '@uyut/catalog'
import type { PlanGeometry, PlanOpening, PlanPoint, PlanWall, RoomMeasurements } from '@uyut/db'

const BOUNDARY_TOLERANCE_CM = 20

export type GeometryRoomLayoutInput = RoomLayoutInput & {
  widthCm: number
  depthCm: number
  reservations: WallReservation[]
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
}

function pointAlongWall(wall: PlanWall, distanceCm: number): PlanPoint {
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  const ratio = length > 0 ? distanceCm / length : 0
  return {
    xCm: wall.start.xCm + (wall.end.xCm - wall.start.xCm) * ratio,
    yCm: wall.start.yCm + (wall.end.yCm - wall.start.yCm) * ratio,
  }
}

function openingPoints(opening: PlanOpening, wall: PlanWall): [PlanPoint, PlanPoint] {
  return [
    pointAlongWall(wall, opening.offsetCm),
    pointAlongWall(wall, opening.offsetCm + opening.widthCm),
  ]
}

function clearanceCm(type: PlanOpening['type']): number {
  return type === 'door' || type === 'balcony' ? 90 : 0
}

function reservationKind(type: PlanOpening['type']): WallReservation['kind'] {
  return type
}

/**
 * Переводит глобальный контур и проёмы плана в локальные координаты комнаты.
 * Размеры ручного обмера имеют приоритет, поэтому вместе с рамкой масштабируется и сам контур.
 */
export function roomLayoutInputFromGeometry(
  geometry: PlanGeometry | undefined,
  roomName: string,
  measurements: RoomMeasurements | null | undefined,
): GeometryRoomLayoutInput | null {
  if (geometry?.status !== 'confirmed') return null
  const room = geometry.rooms.find(
    (candidate) => normalizedName(candidate.name) === normalizedName(roomName),
  )
  if (!room || room.polygon.length < 3) return null

  const xs = room.polygon.map((point) => point.xCm)
  const ys = room.polygon.map((point) => point.yCm)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const geometryWidth = maxX - minX
  const geometryDepth = maxY - minY
  if (geometryWidth <= 0 || geometryDepth <= 0) return null

  const widthCm =
    measurements?.widthCm && measurements.widthCm > 0 ? measurements.widthCm : geometryWidth
  const depthCm =
    measurements?.depthCm && measurements.depthCm > 0 ? measurements.depthCm : geometryDepth
  const scaleX = widthCm / geometryWidth
  const scaleY = depthCm / geometryDepth
  const floorPolygon = room.polygon.map((point) => ({
    xCm: Math.round((point.xCm - minX) * scaleX),
    yCm: Math.round((point.yCm - minY) * scaleY),
  }))
  const wallById = new Map(geometry.walls.map((wall) => [wall.id, wall]))
  const reservations: WallReservation[] = []

  for (const opening of geometry.openings) {
    const wall = wallById.get(opening.wallId)
    if (!wall) continue
    const [start, end] = openingPoints(opening, wall)
    const horizontal =
      Math.abs(wall.end.xCm - wall.start.xCm) >= Math.abs(wall.end.yCm - wall.start.yCm)
    if (horizontal) {
      const y = (start.yCm + end.yCm) / 2
      const wallSide =
        Math.abs(y - minY) <= BOUNDARY_TOLERANCE_CM
          ? 'top'
          : Math.abs(y - maxY) <= BOUNDARY_TOLERANCE_CM
            ? 'bottom'
            : null
      if (!wallSide) continue
      const clippedStart = Math.max(minX, Math.min(start.xCm, end.xCm))
      const clippedEnd = Math.min(maxX, Math.max(start.xCm, end.xCm))
      if (clippedEnd <= clippedStart) continue
      reservations.push({
        kind: reservationKind(opening.type),
        wall: wallSide,
        fromCm: Math.round((clippedStart - minX) * scaleX),
        toCm: Math.round((clippedEnd - minX) * scaleX),
        clearanceCm: clearanceCm(opening.type),
      })
      continue
    }

    const x = (start.xCm + end.xCm) / 2
    const wallSide =
      Math.abs(x - minX) <= BOUNDARY_TOLERANCE_CM
        ? 'left'
        : Math.abs(x - maxX) <= BOUNDARY_TOLERANCE_CM
          ? 'right'
          : null
    if (!wallSide) continue
    const clippedStart = Math.max(minY, Math.min(start.yCm, end.yCm))
    const clippedEnd = Math.min(maxY, Math.max(start.yCm, end.yCm))
    if (clippedEnd <= clippedStart) continue
    reservations.push({
      kind: reservationKind(opening.type),
      wall: wallSide,
      fromCm: Math.round((clippedStart - minY) * scaleY),
      toCm: Math.round((clippedEnd - minY) * scaleY),
      clearanceCm: clearanceCm(opening.type),
    })
  }

  return {
    widthCm: Math.round(widthCm),
    depthCm: Math.round(depthCm),
    floorPolygon,
    ...(measurements?.layoutNotes ? { layoutNotes: measurements.layoutNotes } : {}),
    reservations,
  }
}
