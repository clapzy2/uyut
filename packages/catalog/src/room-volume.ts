import type { PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { z } from 'zod'
import type { RoomLayout } from './layout'
import { signedElevationSum } from './plan-vertical-floor-geometry'
import type {
  PlanSolidFace,
  PlanVolume,
  VolumeFloorZone,
  VolumeFurniture,
} from './plan-volume-types'

function rectangle(x: number, y: number, width: number, depth: number): PlanPoint[] {
  return [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
}

const pointSchema = z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).strict()
const polygonSchema = z.array(pointSchema).min(3).max(2000)
const levelSchema = z
  .object({
    referenceId: z.string().min(1),
    referenceKind: z.enum(['existing-floor', 'finished-floor']),
    zeroFloorId: z.string().min(1),
    floorId: z.string().min(1),
    elevationCm: z.number().finite().min(-600).max(600),
    surface: z.literal('finished-floor'),
    reviewKey: z.string().min(1),
    worldPolygon: polygonSchema,
    origin: pointSchema,
    surfaces: z
      .array(z.object({ floor: polygonSchema, voids: z.array(polygonSchema).max(200) }).strict())
      .min(1)
      .max(200),
  })
  .strict()

function clippingPolygon(floor: readonly PlanPoint[], voids: readonly PlanPoint[][] = []): Polygon {
  return [floor, ...voids].map((ring) => ring.map((point) => [point.xCm, point.yCm]))
}

/** Whole polygon containment, including concave cuts and internal holes, not vertex-only checks. */
export function onPhysicalFloor(
  polygon: readonly PlanPoint[],
  surfaces: readonly { floor: PlanPoint[]; voids: PlanPoint[][] }[],
): boolean {
  try {
    const allowed: MultiPolygon = surfaces.map((surface) =>
      clippingPolygon(surface.floor, surface.voids),
    )
    return polygonClipping.difference(clippingPolygon(polygon), allowed).length === 0
  } catch {
    return false
  }
}

export function validRoomFloorLevel(layout: RoomLayout): boolean {
  if (layout.floorLevel === undefined) return true
  const parsed = levelSchema.safeParse(layout.floorLevel)
  if (!parsed.success || !layout.floorPolygon) return false
  const level = parsed.data
  const vertexCount = level.surfaces.reduce(
    (count, surface) =>
      count + surface.floor.length + surface.voids.reduce((total, hole) => total + hole.length, 0),
    0,
  )
  if (vertexCount > 4096) return false
  if (level.worldPolygon.length !== layout.floorPolygon.length) return false
  if (
    level.origin.xCm !== Math.min(...level.worldPolygon.map((point) => point.xCm)) ||
    level.origin.yCm !== Math.min(...level.worldPolygon.map((point) => point.yCm))
  )
    return false
  if (
    !level.worldPolygon.every((point, index) => {
      const local = layout.floorPolygon?.[index]
      return (
        local &&
        point.xCm - level.origin.xCm === local.xCm &&
        point.yCm - level.origin.yCm === local.yCm
      )
    })
  )
    return false
  const localFloor = layout.floorPolygon
  return level.surfaces.every((surface) =>
    onPhysicalFloor(surface.floor, [{ floor: localFloor, voids: [] }]),
  )
}

/** Keep the exact local coordinates of the current 2D layout, including rotated footprints. */
export function roomVolume(layout: RoomLayout): PlanVolume | null {
  if (!validRoomFloorLevel(layout)) return null
  const level = layout.floorLevel
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
      itemId: item.itemId,
      title: item.title,
      floor: rectangle(item.xCm, item.yCm, item.widthCm, item.depthCm),
      ...(level ? { baseCm: level.elevationCm } : {}),
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
  if (
    level &&
    (furniture.some((item) => !onPhysicalFloor(item.floor, level.surfaces)) ||
      floorZones
        .filter((zone) => zone.kind === 'operation')
        .some((zone) => !onPhysicalFloor(zone.floor, level.surfaces)))
  )
    return null
  if (level) {
    // Opening/radiator margins may cross a room edge. Render only their actual floor area;
    // operation zones were checked whole above and must not be truncated into feasibility.
    const clippedZones: VolumeFloorZone[] = []
    try {
      const allowed: MultiPolygon = level.surfaces.map((surface) =>
        clippingPolygon(surface.floor, surface.voids),
      )
      for (const zone of floorZones) {
        if (zone.kind === 'operation') {
          clippedZones.push({ ...zone, baseCm: level.elevationCm })
          continue
        }
        const clipped = polygonClipping.intersection(clippingPolygon(zone.floor), allowed)
        for (const [index, polygon] of clipped.entries()) {
          // VolumeFloorZone has no hole contract. Hold rather than paint over a shaft.
          if (polygon.length !== 1 || !polygon[0]) return null
          const ring = polygon[0].slice(0, -1)
          clippedZones.push({
            ...zone,
            id: `${zone.id}-${index}`,
            baseCm: level.elevationCm,
            floor: ring.map(([xCm, yCm]) => ({ xCm, yCm })),
          })
        }
      }
    } catch {
      return null
    }
    floorZones.splice(0, floorZones.length, ...clippedZones)
  }
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
      ...(level ? { baseCm: level.elevationCm } : {}),
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
      ...(level ? { baseCm: level.elevationCm } : {}),
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
    ...(level
      ? {
          floorSurfaces: level.surfaces.map((surface, index) => ({
            ...structuredClone(surface),
            id: `${level.floorId}-${index}`,
            floorId: level.floorId,
            title: level.floorId,
            elevationCm: level.elevationCm,
            surface: level.surface,
          })),
          verticalDatum: {
            id: level.referenceId,
            kind: level.referenceKind,
            zeroFloorId: level.zeroFloorId,
          },
        }
      : {}),
    layoutNote:
      `${layout.floorPolygon ? 'Контур пола перенесён из текущей 2D-расстановки.' : 'Пол показан прямоугольным по габариту текущей 2D-расстановки.'} Стены и высоты проёмов здесь не достраиваются. ${layout.measurementNote ?? ''}`.trim(),
  }
}

export type FurnitureFace = PlanSolidFace & {
  furnitureId: string
  furnitureTitle: string
  footprintOnly: boolean
}

/** Boxes represent dimensions, not a guessed furniture shape. Unknown heights stay flat. */
export function furnitureFaces(items: readonly VolumeFurniture[]): FurnitureFace[] {
  return items.flatMap((item) => {
    const common = {
      kind: 'inner' as const,
      furnitureId: item.id,
      furnitureTitle: item.title,
      footprintOnly: item.heightCm === undefined,
    }
    const base = item.baseCm ?? 0
    if (!Number.isFinite(base)) return []
    const floor = item.floor.map((point) => ({ ...point, zCm: base }))
    const height = item.heightCm
    if (height === undefined) {
      return [{ ...common, id: `furniture-${item.id}-floor`, role: 'cap' as const, points: floor }]
    }
    if (!Number.isFinite(height) || height <= 0) return []
    let topElevation: number
    try {
      topElevation = signedElevationSum(base, height)
    } catch {
      return []
    }
    const top = item.floor.map((point) => ({ ...point, zCm: topElevation }))
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
