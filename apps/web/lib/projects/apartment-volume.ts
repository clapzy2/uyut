import type { RoomLayout } from '@uyut/catalog'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { polygonsOverlap } from './plan-page-review'
import {
  type PlanVolume,
  planVolume,
  type VolumeFloorZone,
  type VolumeFurniture,
  type VolumeRoom,
} from './plan-volume'
import { roomVolume } from './room-volume'

export type ApartmentRoomLayout = {
  roomId: string
  roomName: string
  layout: RoomLayout
}

// Floating-point arithmetic only: this is not a measurement or fitting tolerance.
const COORDINATE_EPSILON_CM = 1e-6

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
}

function equalCoordinate(first: number, second: number): boolean {
  return Number.isFinite(first) && Math.abs(first - second) <= COORDINATE_EPSILON_CM
}

/** A cyclic shift or reversed winding changes no coordinates or room shape. */
function sameContour(first: readonly PlanPoint[], second: readonly PlanPoint[]): boolean {
  if (first.length !== second.length || first.length < 3) return false
  return second.some((_, offset) =>
    [1, -1].some((direction) =>
      first.every((point, index) => {
        const candidate = second[(offset + direction * index + second.length) % second.length]
        return (
          candidate !== undefined &&
          equalCoordinate(point.xCm, candidate.xCm) &&
          equalCoordinate(point.yCm, candidate.yCm)
        )
      }),
    ),
  )
}

/** Transfer existing room layouts by translation only; never fit them into another outline. */
export function apartmentVolume(
  geometry: PlanGeometry,
  rooms: readonly ApartmentRoomLayout[],
): { model: PlanVolume | null; notes: string[] } {
  const model = planVolume(geometry)
  if (!model) {
    return {
      model: null,
      notes: [
        'Для общего просмотра нужен подтверждённый контур квартиры с согласованными мерками.',
      ],
    }
  }
  const notes: string[] = []
  const kitchenFurniture = model.furniture ?? []
  const furniture: VolumeFurniture[] = [...kitchenFurniture]
  const issues = [...model.issues]
  const floorZones: VolumeFloorZone[] = [...(model.floorZones ?? [])]
  const matchedRooms: VolumeRoom[] = [...(model.rooms ?? [])]
  for (const room of rooms) {
    const name = normalizedName(room.roomName)
    const matches = geometry.rooms.filter((candidate) => normalizedName(candidate.name) === name)
    const matchingLayouts = rooms.filter((candidate) => normalizedName(candidate.roomName) === name)
    const matchingIds = rooms.filter((candidate) => candidate.roomId === room.roomId)
    const sourceRoom = matches[0]
    const omit = (reason: string) => {
      notes.push(`${room.roomName}: мебель пока показана только в комнате — ${reason}.`)
    }
    if (!name || matches.length === 0) {
      omit('в плане квартиры нет комнаты с этим названием')
      continue
    }
    if (matches.length !== 1 || matchingLayouts.length !== 1 || matchingIds.length !== 1) {
      omit('название или связь комнаты неоднозначны; уточните их перед совмещением')
      continue
    }
    if (
      !sourceRoom ||
      sourceRoom.sourceNumbers ||
      sourceRoom.polygon.length < 3 ||
      geometry.pdfCalibration?.derivedOpeningIds.length
    ) {
      omit('отдельный исходный контур комнаты ещё не подтверждён')
      continue
    }
    const originX = Math.min(...sourceRoom.polygon.map((point) => point.xCm))
    const originY = Math.min(...sourceRoom.polygon.map((point) => point.yCm))
    const width = Math.max(...sourceRoom.polygon.map((point) => point.xCm)) - originX
    const depth = Math.max(...sourceRoom.polygon.map((point) => point.yCm)) - originY
    const localFloor = sourceRoom.polygon.map((point) => ({
      xCm: point.xCm - originX,
      yCm: point.yCm - originY,
    }))
    if (!room.layout.floorPolygon) {
      omit('расстановка использует прямоугольный габарит без исходного контура')
      continue
    }
    if (
      !equalCoordinate(room.layout.widthCm, width) ||
      !equalCoordinate(room.layout.depthCm, depth) ||
      !sameContour(room.layout.floorPolygon, localFloor)
    ) {
      omit('контур или масштаб расстановки отличается от плана; мебель не растягивается')
      continue
    }
    const localModel = roomVolume(room.layout)
    const items = localModel?.furniture
    if (!items || new Set(items.map((item) => item.id)).size !== items.length) {
      omit('координаты мебели или идентификаторы размещений требуют уточнения')
      continue
    }
    const sourceOnlyIndex = matchedRooms.findIndex(
      (candidate) => candidate.sourceOnly && normalizedName(candidate.title) === name,
    )
    if (sourceOnlyIndex !== -1) matchedRooms.splice(sourceOnlyIndex, 1)
    matchedRooms.push({
      id: room.roomId,
      title: room.roomName,
      floor: sourceRoom.polygon.map((point) => ({ ...point })),
    })
    furniture.push(
      ...items.map((item) => ({
        ...item,
        id: JSON.stringify([room.roomId, item.id]),
        roomId: room.roomId,
        title: `${room.roomName} — ${item.title}`,
        floor: item.floor.map((point) => ({
          xCm: point.xCm + originX,
          yCm: point.yCm + originY,
        })),
      })),
    )
    floorZones.push(
      ...(localModel?.floorZones ?? []).map((zone) => ({
        ...zone,
        id: JSON.stringify([room.roomId, zone.id]),
        roomId: room.roomId,
        title: `${room.roomName} — ${zone.title}`,
        floor: zone.floor.map((point) => ({
          xCm: point.xCm + originX,
          yCm: point.yCm + originY,
        })),
      })),
    )
  }
  for (const kitchen of kitchenFurniture) {
    for (const item of furniture.slice(kitchenFurniture.length)) {
      if (
        polygonsOverlap(
          kitchen.floor.map((point) => ({ x: point.xCm, y: point.yCm })),
          item.floor.map((point) => ({ x: point.xCm, y: point.yCm })),
        )
      ) {
        issues.push({
          id: `volume-kitchen-furniture-overlap-${kitchen.id}-${item.id}`,
          severity: 'warning',
          message: `${kitchen.title} пересекается с мебелью «${item.title}». Проверьте, не указан ли один предмет дважды.`,
        })
      }
    }
  }
  return { model: { ...model, furniture, floorZones, rooms: matchedRooms, issues }, notes }
}
