import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import type { LayoutItem, LayoutRoomKind, RoomLayout } from './layout'
import { layoutWithMeasurements as horizontalLayout } from './layout-with-measurements'
import { measurementNotice } from './measurement-assurance'
import {
  signedElevationSum,
  signedPlanFloors,
  verticalReferenceReviewKey,
} from './plan-vertical-floor-geometry'
import { roomVolume } from './room-volume'

/** Reviewed opt-in layout shared by the website and PDF worker; no flat fallback for a datum. */
export function layoutWithMeasurements(
  name: string,
  measurements: RoomMeasurements | null,
  geometry: PlanGeometry | undefined,
  items: readonly LayoutItem[],
  roomKind?: LayoutRoomKind,
): RoomLayout | null {
  if (geometry?.verticalReference === undefined)
    return horizontalLayout(name, measurements, geometry, items, roomKind)
  const floors = signedPlanFloors(geometry)
  if (!floors?.ok) return null
  const normalize = (value: string) => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
  const rooms = geometry.rooms.filter((room) => normalize(room.name) === normalize(name))
  const room = rooms[0]
  if (rooms.length !== 1 || !room) return null
  const owners = floors.reference.floors.filter(
    (floor) =>
      floor.room.name === room.name &&
      floor.room.spaceKind === room.spaceKind &&
      floor.room.sourceNumber === room.sourceNumber &&
      JSON.stringify(floor.room.sourceNumbers) === JSON.stringify(room.sourceNumbers) &&
      floor.room.polygon.length === room.polygon.length &&
      floor.room.polygon.every(
        (point, index) =>
          point.xCm === room.polygon[index]?.xCm && point.yCm === room.polygon[index]?.yCm,
      ),
  )
  const owner = owners[0]
  if (owners.length !== 1 || !owner || owner.surface !== 'finished-floor') return null
  const origin = {
    xCm: Math.min(...room.polygon.map((point) => point.xCm)),
    yCm: Math.min(...room.polygon.map((point) => point.yCm)),
  }
  const { verticalReference: _reference, ...horizontal } = geometry
  // Null measurements forbid both scale overrides and rectangular fallback.
  const layout = horizontalLayout(name, null, horizontal, items, roomKind)
  if (!layout?.floorPolygon) return null
  const surfaces = floors.surfaces.filter((surface) => surface.floorId === owner.id)
  if (!surfaces.length) return null
  const local = (point: { xCm: number; yCm: number }) => ({
    xCm: point.xCm - origin.xCm,
    yCm: point.yCm - origin.yCm,
  })
  const result: RoomLayout = {
    ...layout,
    measurementNote: `${measurementNotice(measurements)} Контур перенесён без растягивания; отметка пола сверена в общем отсчёте. Проверка размеров и проходов остаётся отдельной.`,
    floorLevel: {
      referenceId: floors.reference.id,
      referenceKind: floors.reference.kind,
      zeroFloorId: floors.reference.zeroFloorId,
      floorId: owner.id,
      elevationCm: owner.elevationCm,
      surface: owner.surface,
      reviewKey: verticalReferenceReviewKey(floors.reference),
      worldPolygon: structuredClone(room.polygon),
      origin,
      surfaces: surfaces.map((surface) => ({
        floor: surface.floor.map(local),
        voids: surface.voids.map((hole) => hole.map(local)),
      })),
    },
  }
  for (const [label, measured, outlined] of [
    ['Ширина', measurements?.widthCm, layout.widthCm],
    ['Глубина', measurements?.depthCm, layout.depthCm],
  ] as const) {
    if (measured !== undefined && measured !== null && measured !== outlined) {
      const detail = `${label}: мерка ${measured} см отличается от контура ${outlined} см; уточните данные, схема не растягивается.`
      result.missingSafetyData.push(detail)
      result.safetyChecks.push({
        id: `signed-dimension-${label}`,
        label: `${label}: сверка с контуром`,
        detail,
        status: 'needs-data',
      })
      if (result.safetySummary.status !== 'blocked') {
        result.safetySummary = {
          status: 'needs-data',
          title: 'Нужна сверка мерок с контуром',
          detail,
        }
      }
    }
  }
  const ceiling = floors.reference.ceilings?.find((entry) => entry.floorId === owner.id)
  const heightByItem = new Map(result.placementInputs.map((item) => [item.id, item.heightCm]))
  if (!ceiling) {
    const detail =
      'Отметка чистового потолка в общем отсчёте не подтверждена; вертикальное размещение мебели не проверено.'
    result.missingSafetyData.push(detail)
    result.safetyChecks.push({
      id: 'signed-ceiling-unknown',
      label: 'Высота до потолка',
      detail,
      status: 'needs-data',
    })
    if (result.safetySummary.status !== 'blocked')
      result.safetySummary = { status: 'needs-data', title: 'Нужна отметка потолка', detail }
  }
  for (const item of result.placed) {
    const height = heightByItem.get(item.itemId)
    if (height === undefined || !Number.isFinite(height) || height <= 0) {
      const detail = `«${item.title}»: высота товара неизвестна; показан только габарит на полу, вертикальное размещение не проверено.`
      result.missingSafetyData.push(detail)
      result.safetyChecks.push({
        id: `signed-height-${item.id}`,
        label: `${item.title}: высота`,
        detail,
        status: 'needs-data',
      })
      if (result.safetySummary.status !== 'blocked')
        result.safetySummary = { status: 'needs-data', title: 'Нужна высота мебели', detail }
      continue
    }
    if (!ceiling) continue
    const top = signedElevationSum(owner.elevationCm, height)
    const blocked = top > ceiling.elevationCm
    const detail = `«${item.title}»: верх ${top} см, потолок ${ceiling.elevationCm} см в общем отсчёте. ${blocked ? 'Предмет выше потолка; размеры мебели не уменьшаются.' : 'Габарит по высоте не превышает отметку потолка; монтажные зазоры уточните отдельно.'}`
    result.safetyChecks.push({
      id: `signed-height-${item.id}`,
      label: `${item.title}: высота до потолка`,
      detail,
      status: blocked ? 'blocked' : 'checked',
    })
    if (blocked) result.safetySummary = { status: 'blocked', title: 'Мебель выше потолка', detail }
  }
  // A catalog candidate outside clipped physical floor must never float over an unknown region.
  return roomVolume(result) ? result : null
}
