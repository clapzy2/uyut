import type { RoomLayout } from '@uyut/catalog'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import {
  type PlanVolume,
  planVolume,
  type VolumeFloorZone,
  type VolumeFurniture,
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
  const furniture: VolumeFurniture[] = []
  const floorZones: VolumeFloorZone[] = []
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
    furniture.push(
      ...items.map((item) => ({
        ...item,
        id: JSON.stringify([room.roomId, item.id]),
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
        title: `${room.roomName} — ${zone.title}`,
        floor: zone.floor.map((point) => ({
          xCm: point.xCm + originX,
          yCm: point.yCm + originY,
        })),
      })),
    )
  }
  return { model: { ...model, furniture, floorZones }, notes }
}
