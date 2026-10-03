import type { RoomLayout } from '@uyut/catalog'
import type { PlanPoint } from '@uyut/db'
import type { PlanSolidFace, PlanVolume, VolumeFloorZone, VolumeFurniture } from './plan-volume'

function rectangle(x: number, y: number, width: number, depth: number): PlanPoint[] {
  return [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
}

/** Keep the exact local coordinates of the current 2D layout, including rotated footprints. */
export function roomVolume(layout: RoomLayout): PlanVolume | null {
  if (
    !(layout.widthCm > 0) ||
    !(layout.depthCm > 0) ||
    !Number.isFinite(layout.widthCm) ||
    !Number.isFinite(layout.depthCm)
  )
    return null
  const floor = layout.floorPolygon ?? rectangle(0, 0, layout.widthCm, layout.depthCm)
  if (
    floor.length < 3 ||
    floor.some((point) => !Number.isFinite(point.xCm) || !Number.isFinite(point.yCm))
  )
    return null
  if (
    layout.placed.some(
      (item) =>
        ![item.xCm, item.yCm, item.widthCm, item.depthCm].every(Number.isFinite) ||
        item.widthCm <= 0 ||
        item.depthCm <= 0,
    )
  )
    return null
  const heights = new Map(layout.placementInputs.map((item) => [item.id, item.heightCm]))
  const furniture = layout.placed.map((item): VolumeFurniture => {
    const height = heights.get(item.itemId)
    return {
      id: item.id,
      title: item.title,
      floor: rectangle(item.xCm, item.yCm, item.widthCm, item.depthCm),
      ...(height !== undefined && Number.isFinite(height) && height > 0
        ? { heightCm: height }
        : {}),
    }
  })
  const floorZones: VolumeFloorZone[] = [
    ...layout.keepClearZones.map((zone, index) => ({
      id: `keep-clear-${index}`,
      title: zone.label,
      kind: zone.kind,
      floor: zone.polygon.map((point) => ({ ...point })),
    })),
    ...layout.functionalZones.map((zone, index) => ({
      id: `operation-${zone.placementId}-${index}`,
      title: `${zone.title} · зона использования · запас ${zone.clearanceCm} см`,
      kind: 'operation' as const,
      floor: rectangle(zone.xCm, zone.yCm, zone.widthCm, zone.depthCm),
      preliminary: zone.source === 'preliminary',
    })),
  ].filter(
    (zone) =>
      zone.floor.length >= 3 &&
      zone.floor.every((point) => Number.isFinite(point.xCm) && Number.isFinite(point.yCm)),
  )
  const openings: PlanVolume['openings'] = layout.floorReservations
    .filter(
      (opening) =>
        opening.kind === 'door' || opening.kind === 'window' || opening.kind === 'balcony',
    )
    .map((opening, index) => ({
      id: `room-opening-${index}`,
      type: opening.kind === 'window' ? 'window' : opening.kind === 'balcony' ? 'balcony' : 'door',
      start: opening.start,
      end: opening.end,
      cut: false,
    }))
  // Text-only radiators and ventilation zones are not door openings.
  for (const [index, opening] of layout.reservations.entries()) {
    if (
      layout.floorReservations.length > 0 ||
      (opening.kind !== 'door' && opening.kind !== 'window' && opening.kind !== 'balcony')
    )
      continue
    const start =
      opening.wall === 'top' || opening.wall === 'bottom'
        ? { xCm: opening.fromCm, yCm: opening.wall === 'top' ? 0 : layout.depthCm }
        : { xCm: opening.wall === 'left' ? 0 : layout.widthCm, yCm: opening.fromCm }
    const end =
      opening.wall === 'top' || opening.wall === 'bottom'
        ? { ...start, xCm: opening.toCm }
        : { ...start, yCm: opening.toCm }
    openings.push({
      id: `room-text-opening-${index}`,
      type: opening.kind,
      start,
      end,
      cut: false,
    })
  }
  return {
    floor,
    voids: [],
    walls: [],
    solidFaces: [],
    issues: [],
    joinedSolids: false,
    wallSource: 'room-layout',
    furniture,
    floorZones,
    openings,
    layoutNote:
      `${layout.floorPolygon ? 'Контур пола перенесён из текущей 2D-расстановки.' : 'Пол показан прямоугольным по габариту текущей 2D-расстановки.'} Стены и высоты проёмов здесь не достраиваются. ${layout.measurementNote ?? ''}`.trim(),
  }
}

export type FurnitureFace = PlanSolidFace & { furnitureTitle: string; footprintOnly: boolean }

/** Boxes represent dimensions, not a guessed furniture shape. Unknown heights stay flat. */
export function furnitureFaces(items: readonly VolumeFurniture[]): FurnitureFace[] {
  return items.flatMap((item) => {
    const common = {
      kind: 'inner' as const,
      furnitureTitle: item.title,
      footprintOnly: item.heightCm === undefined,
    }
    const floor = item.floor.map((point) => ({ ...point, zCm: 0 }))
    const height = item.heightCm
    if (height === undefined) {
      return [{ ...common, id: `furniture-${item.id}-floor`, role: 'cap' as const, points: floor }]
    }
    const top = item.floor.map((point) => ({ ...point, zCm: height }))
    const faces: FurnitureFace[] = [
      { ...common, id: `furniture-${item.id}-bottom`, role: 'cap', points: [...floor].reverse() },
      { ...common, id: `furniture-${item.id}-top`, role: 'cap', points: top },
    ]
    for (const [index, start] of floor.entries()) {
      const next = (index + 1) % floor.length
      const end = floor[next]
      const topEnd = top[next]
      const topStart = top[index]
      if (!end || !topEnd || !topStart) continue
      faces.push({
        ...common,
        id: `furniture-${item.id}-side-${index}`,
        role: 'face',
        points: [start, end, topEnd, topStart],
      })
    }
    return faces
  })
}
