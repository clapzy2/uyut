import { kitchenClearanceZones } from '@uyut/catalog/geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { kitchenItemIssues, kitchenItemsSchema, kitchenLabels } from './kitchen-items'
import type { PlanGeometryIssue } from './plan-geometry-inspection'
import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
  currentWallFacePairs,
} from './plan-opening-face-pairs'
import {
  inspectPlanVerticalDimensions,
  type PlanVerticalMeasurementReport,
  planVerticalMeasurementReport,
} from './plan-vertical-dimensions'
import { signedElevationSum, signedPlanFloors } from './plan-vertical-floor-geometry'
import { wallElevationPanels } from './wall-elevation'
import { type WallSolidFace, wallSolidFaces } from './wall-solid'
import { joinWallSolids } from './wall-solid-union'

export type WallSpan = {
  id: string
  start: PlanPoint
  end: PlanPoint
  kind: 'outer' | 'inner'
  bottomCm: number
  topCm?: number
  solid?: boolean
  wallId: string
  thicknessCm?: number
}

export type PlanSolidFace = {
  id: string
  kind: 'outer' | 'inner'
  role: WallSolidFace['role']
  points: (PlanPoint & { zCm: number })[]
  holes?: (PlanPoint & { zCm: number })[][]
}

export type OpeningSpan = {
  id: string
  type: 'door' | 'window' | 'balcony'
  start: PlanPoint
  end: PlanPoint
  bottomCm?: number
  heightCm?: number
  cut: boolean
  /** Measured supporting floor in the common datum; bottomCm in this viewing DTO is global. */
  baseCm?: number
}

export type VolumeFloorSurface = {
  id: string
  floorId: string
  title: string
  floor: PlanPoint[]
  voids: PlanPoint[][]
  elevationCm: number
  surface: 'existing-floor' | 'finished-floor'
  roomId?: string
}

export type VolumeThreshold = {
  id: string
  floor: PlanPoint[]
  elevationCm: number
  floorIds: [string, string]
  floorElevationsCm: [number, number]
}

export type PlanVolume = {
  floor: PlanPoint[]
  voids: PlanPoint[][]
  walls: WallSpan[]
  openings: OpeningSpan[]
  wallSource: 'centerline' | 'pdf-faces' | 'room-layout'
  solidFaces: PlanSolidFace[]
  joinedSolids: boolean
  issues: PlanGeometryIssue[]
  furniture?: VolumeFurniture[]
  floorZones?: VolumeFloorZone[]
  rooms?: VolumeRoom[]
  layoutNote?: string
  verticalMeasurements?: PlanVerticalMeasurementReport
  /** Presence replaces the legacy whole-footprint floor at Z=0. */
  floorSurfaces?: VolumeFloorSurface[]
  thresholds?: VolumeThreshold[]
  verticalDatum?: { id: string; kind: 'existing-floor' | 'finished-floor'; zeroFloorId: string }
}

export type VolumeRoom = {
  id: string
  title: string
  floor: PlanPoint[]
  /** A source contour without a linked project-room page. */
  sourceOnly?: boolean
  baseCm?: number
  floorId?: string
}

export type VolumeFloorZone = {
  id: string
  roomId?: string
  title: string
  kind: 'door' | 'balcony' | 'radiator' | 'obstacle' | 'operation'
  floor: PlanPoint[]
  preliminary?: boolean
  baseCm?: number
}

export type VolumeFurniture = {
  id: string
  itemId?: string
  roomId?: string
  title: string
  floor: PlanPoint[]
  heightCm?: number
  baseCm?: number
}

function interpolate(start: PlanPoint, end: PlanPoint, ratio: number): PlanPoint {
  return {
    xCm: start.xCm + (end.xCm - start.xCm) * ratio,
    yCm: start.yCm + (end.yCm - start.yCm) * ratio,
  }
}

/** Only complete vertical measurements can remove part of a wall surface. */
function addWallInterval(
  walls: WallSpan[],
  openings: OpeningSpan[],
  wall: PlanGeometry['walls'][number],
  intervalStart: PlanPoint,
  intervalEnd: PlanPoint,
  sourceOpenings: PlanGeometry['openings'],
  solidFaces: PlanSolidFace[],
  {
    allowThickness,
    recordOpenings,
    baseCm,
  }: { allowThickness: boolean; recordOpenings: boolean; baseCm?: number },
) {
  const base = baseCm ?? 0
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  if (length <= 0) return

  const distance = (point: PlanPoint) =>
    ((point.xCm - wall.start.xCm) * (wall.end.xCm - wall.start.xCm) +
      (point.yCm - wall.start.yCm) * (wall.end.yCm - wall.start.yCm)) /
    length
  const startDistance = Math.max(0, Math.min(length, distance(intervalStart)))
  const endDistance = Math.max(0, Math.min(length, distance(intervalEnd)))
  const low = Math.min(startDistance, endDistance)
  const high = Math.max(startDistance, endDistance)
  if (high - low < 0.001) return

  const pointAt = (distanceCm: number) => interpolate(wall.start, wall.end, distanceCm / length)
  const spans = sourceOpenings
    .filter((opening) => opening.wallId === wall.id && opening.widthCm > 0)
    .map((opening) => ({
      opening,
      start: Math.max(low, opening.offsetCm),
      end: Math.min(high, opening.offsetCm + opening.widthCm),
    }))
    .filter((cut) => cut.end > cut.start)

  const measuredCuts = spans.flatMap(({ opening, start, end }) =>
    opening.bottomCm !== undefined && opening.heightCm !== undefined
      ? [
          {
            startCm: start - low,
            endCm: end - low,
            bottomCm: opening.bottomCm,
            heightCm: opening.heightCm,
          },
        ]
      : [],
  )
  const measuredPanels =
    wall.heightCm === undefined
      ? undefined
      : wallElevationPanels(high - low, wall.heightCm, measuredCuts)
  const panels =
    wall.heightCm === undefined
      ? [{ startCm: 0, endCm: high - low, bottomCm: 0, topCm: undefined }]
      : measuredPanels
  if (!panels) return
  // A PDF face is not a centreline, even when its wall carries a reviewed thickness.
  const solid =
    allowThickness && wall.heightCm !== undefined && wall.measuredThicknessCm !== undefined
  for (const panel of panels) {
    walls.push({
      id: `${wall.id}-${low}-${high}-${panel.startCm}-${panel.bottomCm}`,
      wallId: wall.id,
      start: pointAt(low + panel.startCm),
      end: pointAt(low + panel.endCm),
      kind: wall.kind,
      bottomCm: signedElevationSum(base, panel.bottomCm),
      topCm: panel.topCm === undefined ? undefined : signedElevationSum(base, panel.topCm),
      ...(solid ? { solid: true, thicknessCm: wall.measuredThicknessCm } : {}),
    })
  }
  if (
    solid &&
    measuredPanels &&
    wall.heightCm !== undefined &&
    wall.measuredThicknessCm !== undefined
  ) {
    const localFaces = wallSolidFaces(
      measuredPanels,
      high - low,
      wall.heightCm,
      wall.measuredThicknessCm,
    )
    const normalX = -(wall.end.yCm - wall.start.yCm) / length
    const normalY = (wall.end.xCm - wall.start.xCm) / length
    for (const [index, face] of localFaces.entries()) {
      solidFaces.push({
        id: `${wall.id}-${low}-${high}-solid-${index}`,
        kind: wall.kind,
        role: face.role,
        points: face.points.map((point) => {
          const onAxis = pointAt(low + point.distanceCm)
          return {
            xCm: onAxis.xCm + normalX * point.depthCm,
            yCm: onAxis.yCm + normalY * point.depthCm,
            zCm: signedElevationSum(base, point.heightCm),
          }
        }),
      })
    }
  }

  for (const cut of recordOpenings ? spans : []) {
    openings.push({
      id: `${cut.opening.id}-${low}`,
      type: cut.opening.type,
      start: pointAt(cut.start),
      end: pointAt(cut.end),
      bottomCm:
        cut.opening.bottomCm === undefined
          ? undefined
          : signedElevationSum(base, cut.opening.bottomCm),
      heightCm: cut.opening.heightCm,
      cut:
        wall.heightCm !== undefined &&
        cut.opening.bottomCm !== undefined &&
        cut.opening.heightCm !== undefined,
      ...(baseCm === undefined ? {} : { baseCm }),
    })
  }
}

/** Build a viewing model only from confirmed 2D coordinates and current source relations. */
export function planVolume(geometry: PlanGeometry): PlanVolume | null {
  const signed = signedPlanFloors(geometry)
  if (signed && !signed.ok) return null
  if (geometry.status !== 'confirmed' || !geometry.footprint || geometry.footprint.length < 3) {
    return null
  }
  if (inspectPlanVerticalDimensions(geometry).length > 0) return null
  const kitchenItems = kitchenItemsSchema.safeParse(geometry.kitchenItems ?? [])
  if (!kitchenItems.success) return null

  const walls: WallSpan[] = []
  const openings: OpeningSpan[] = []
  const solidFaces: PlanSolidFace[] = []
  const levelIssues: PlanGeometryIssue[] = []
  const reference = signed?.ok ? signed.reference : undefined
  const floors = new Map(reference?.floors.map((floor) => [floor.id, floor]))
  const wallFloors = new Map(
    reference?.wallBases.map((base) => [base.wall.id, floors.get(base.floorId)]),
  )
  const projectedOpenings: PlanGeometry['openings'] = reference
    ? geometry.openings.map((opening) => {
        const floor = wallFloors.get(opening.wallId)
        if (floor?.surface === 'finished-floor' || opening.bottomCm === undefined) return opening
        levelIssues.push({
          id: `volume-opening-floor-${opening.id}`,
          severity: 'warning',
          openingIds: [opening.id],
          message:
            'Нижняя грань проёма измерена от чистового пола, а его отметка здесь не задана. Проём остаётся условным, без выреза по высоте.',
        })
        const { bottomCm: _localBottom, ...unknownBottom } = opening
        return unknownBottom
      })
    : geometry.openings

  if (geometry.pdfCalibration) {
    if (!reference && geometry.pdfCalibration.exteriorBoundaryRole !== 'floor') return null
    const sourcePairs = geometry.pdfCalibration.sourceWallFacePairs ?? []
    const currentPairs = currentWallFacePairs(geometry)
    if (sourcePairs.length === 0 || currentPairs.length !== sourcePairs.length) return null

    for (const pair of currentPairs) {
      for (const face of pair.faces) {
        const wall = geometry.walls.find((item) => item.id === face.wall.id)
        if (!wall) return null
        const floor = wallFloors.get(wall.id)
        if (reference && !floor) return null
        const currentOpenings = projectedOpenings.filter((item) =>
          pair.openings.some((o) => o.id === item.id),
        )
        addWallInterval(walls, openings, wall, face.start, face.end, currentOpenings, solidFaces, {
          allowThickness: false,
          recordOpenings: false,
          ...(floor ? { baseCm: floor.elevationCm } : {}),
        })
      }
    }
    // Proof intervals exclude door/window gaps. Preserve each source-bound opening
    // independently of those intervals; do not fill the gap with invented wall faces.
    const provenOpeningIds = new Set(currentPairs.flatMap((pair) => pair.openings.map((o) => o.id)))
    for (const opening of projectedOpenings) {
      if (!provenOpeningIds.has(opening.id)) continue
      const wall = geometry.walls.find((candidate) => candidate.id === opening.wallId)
      if (!wall) return null
      const floor = wallFloors.get(wall.id)
      if (reference && !floor) return null
      const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
      if (length <= 0 || opening.offsetCm < 0 || opening.offsetCm + opening.widthCm > length + 1e-7)
        return null
      const endpoints = reference ? openingEndpoints(geometry, opening.id) : undefined
      if (reference && !endpoints) {
        levelIssues.push({
          id: `volume-opening-cut-${opening.id}`,
          severity: 'warning',
          openingIds: [opening.id],
          message:
            'Исходные грани проёма расходятся. Его положение не заменяется приблизительным интервалом по стене.',
        })
        continue
      }
      openings.push({
        id: `${opening.id}-pdf`,
        type: opening.type,
        start: endpoints?.[0] ?? interpolate(wall.start, wall.end, opening.offsetCm / length),
        end:
          endpoints?.[1] ??
          interpolate(wall.start, wall.end, (opening.offsetCm + opening.widthCm) / length),
        bottomCm:
          opening.bottomCm === undefined
            ? undefined
            : signedElevationSum(floor?.elevationCm ?? 0, opening.bottomCm),
        heightCm: opening.heightCm,
        cut:
          wall.heightCm !== undefined &&
          opening.bottomCm !== undefined &&
          opening.heightCm !== undefined,
        ...(floor ? { baseCm: floor.elevationCm } : {}),
      })
    }
  } else {
    for (const wall of geometry.walls) {
      const floor = wallFloors.get(wall.id)
      if (reference && !floor) return null
      addWallInterval(walls, openings, wall, wall.start, wall.end, projectedOpenings, solidFaces, {
        allowThickness: true,
        recordOpenings: true,
        ...(floor ? { baseCm: floor.elevationCm } : {}),
      })
    }
  }

  const globalOpeningBottoms = reference
    ? new Map(
        projectedOpenings.flatMap((opening) => {
          const floor = wallFloors.get(opening.wallId)
          return floor && opening.bottomCm !== undefined
            ? [[opening.id, signedElevationSum(floor.elevationCm, opening.bottomCm)] as const]
            : []
        }),
      )
    : undefined
  const joined = geometry.pdfCalibration
    ? undefined
    : joinWallSolids(walls, geometry, globalOpeningBottoms)
  if (joined === null) return null
  let furniture: VolumeFurniture[] = kitchenItems.data.map((item) => ({
    id: `kitchen:${item.id}`,
    title: kitchenLabels[item.kind],
    floor: [
      { xCm: item.xCm, yCm: item.yCm },
      { xCm: item.xCm + item.widthCm, yCm: item.yCm },
      { xCm: item.xCm + item.widthCm, yCm: item.yCm + item.depthCm },
      { xCm: item.xCm, yCm: item.yCm + item.depthCm },
    ],
    ...(item.heightCm === undefined ? {} : { heightCm: item.heightCm }),
  }))
  const kitchenIssues: PlanGeometryIssue[] = kitchenItemIssues(
    kitchenItems.data,
    geometry.widthCm,
    geometry.heightCm,
    geometry,
  ).map((message, index) => ({
    id: `volume-kitchen-${index}`,
    severity: 'warning',
    message,
  }))
  let floorZones: VolumeFloorZone[] = kitchenItems.data.flatMap((item, index) =>
    kitchenClearanceZones(item, index).map((zone) => ({
      id: `kitchen-zone:${zone.id}`,
      title: zone.label,
      kind: 'operation' as const,
      floor: zone.polygon,
      ...(zone.id.endsWith('-access') &&
      (item.openingDepthCm === undefined || item.passageCm === undefined)
        ? { preliminary: true }
        : {}),
    })),
  )
  const surfaces = signed?.ok ? signed.surfaces : undefined
  const extent = polygonBody(geometry.footprint)
  if (surfaces) {
    const supported = (polygon: PlanPoint[]) =>
      reference?.floors.filter((floor) => {
        if (floor.surface !== 'finished-floor') return false
        const pieces = surfaces
          .filter((surface) => surface.floorId === floor.id)
          .map(surfacePolygon)
        return (
          pieces.length > 0 &&
          polygonClipping.difference(polygonBody(polygon), ...pieces).length === 0
        )
      }) ?? []
    furniture = furniture.flatMap((item) => {
      const owners = supported(item.floor)
      const owner = owners.length === 1 ? owners[0] : undefined
      if (!owner) {
        levelIssues.push({
          id: `volume-floor-owner-${item.id}`,
          severity: 'warning',
          message: `${item.title}: не найден единственный подтверждённый чистовой пол. Предмет не переносится на условный уровень 0.`,
        })
        return []
      }
      const ceiling = reference?.ceilings?.find((ceiling) => ceiling.floorId === owner.id)
      if (
        item.heightCm !== undefined &&
        ceiling &&
        signedElevationSum(owner.elevationCm, item.heightCm) > ceiling.elevationCm
      ) {
        levelIssues.push({
          id: `volume-ceiling-${item.id}`,
          severity: 'error',
          message: `${item.title}: верх предмета выше подтверждённого потолка. Размеры не уменьшены; размещение требует исправления.`,
        })
      } else if (!ceiling || item.heightCm === undefined) {
        levelIssues.push({
          id: `volume-ceiling-unknown-${item.id}`,
          severity: 'warning',
          message: `${item.title}: высота предмета или отметка потолка неизвестна. Вертикальное размещение не проверено.`,
        })
      }
      return [{ ...item, baseCm: owner.elevationCm }]
    })
    floorZones = floorZones.flatMap((zone) => {
      const owners = supported(zone.floor)
      const owner = owners.length === 1 ? owners[0] : undefined
      if (!owner) {
        levelIssues.push({
          id: `volume-zone-floor-${zone.id}`,
          severity: 'warning',
          message: `${zone.title}: рабочая зона выходит за известный чистовой пол. Она не переносится на условный уровень 0.`,
        })
        return []
      }
      return [{ ...zone, baseCm: owner.elevationCm }]
    })
  }
  const thresholdPolygons = new Map(
    reference?.thresholds.map((threshold) => {
      const [a, b] = threshold.bindings
      const first = openingEndpoints(geometry, a.opening.id)
      const second = openingEndpoints(geometry, b.opening.id)
      return [threshold.id, first && second ? thresholdPolygon(first, second) : undefined]
    }),
  )
  const wallStrips = reference
    ? currentWallFacePairs(geometry).map(({ faces: [a, b] }) =>
        polygonBody([a.start, a.end, b.end, b.start]),
      )
    : []
  const thresholds = reference
    ? reference.thresholds.flatMap((threshold) => {
        const [a, b] = threshold.bindings
        const first = openingEndpoints(geometry, a.opening.id)
        const second = openingEndpoints(geometry, b.opening.id)
        const firstFloor = floors.get(a.floorId)
        const secondFloor = floors.get(b.floorId)
        const polygon = thresholdPolygons.get(threshold.id)
        if (
          !polygon ||
          !firstFloor ||
          !secondFloor ||
          !first ||
          !second ||
          !thresholdFacesInward(first, second, firstFloor.room.polygon, secondFloor.room.polygon) ||
          wallStrips.some(
            (strip) => polygonClipping.intersection(polygonBody(polygon), strip).length > 0,
          ) ||
          [...thresholdPolygons].some(
            ([id, other]) =>
              id !== threshold.id &&
              other &&
              polygonClipping.intersection(polygonBody(polygon), polygonBody(other)).length > 0,
          ) ||
          polygonClipping.difference(polygonBody(polygon), extent).length > 0 ||
          (surfaces ?? []).some(
            (surface) =>
              polygonClipping.intersection(polygonBody(polygon), surfacePolygon(surface)).length >
              0,
          ) ||
          (geometry.voids ?? []).some(
            (region) =>
              polygonClipping.intersection(polygonBody(polygon), polygonBody(region.polygon))
                .length > 0,
          )
        ) {
          levelIssues.push({
            id: `volume-threshold-${threshold.id}`,
            severity: 'warning',
            message:
              'Отметка порога сохранена, но его поверхность не удалось однозначно привязать между исходными гранями. Толщина и промежуточный пол не достраиваются.',
          })
          return []
        }
        return [
          {
            id: threshold.id,
            floor: polygon,
            elevationCm: threshold.elevationCm,
            floorIds: [a.floorId, b.floorId] as [string, string],
            floorElevationsCm: [firstFloor.elevationCm, secondFloor.elevationCm] as [
              number,
              number,
            ],
          },
        ]
      })
    : undefined
  return {
    floor: geometry.footprint,
    voids: (geometry.voids ?? []).map((item) => item.polygon),
    walls,
    openings,
    wallSource: geometry.pdfCalibration ? 'pdf-faces' : 'centerline',
    solidFaces: joined?.faces ?? solidFaces,
    joinedSolids: joined !== undefined,
    issues: [...(joined?.issues ?? []), ...kitchenIssues, ...levelIssues],
    verticalMeasurements: planVerticalMeasurementReport(geometry),
    rooms: reference
      ? reference.floors.map((floor) => ({
          id: `plan-floor:${floor.id}`,
          title: floor.room.name,
          floor: floor.room.polygon,
          sourceOnly: true,
          baseCm: floor.elevationCm,
          floorId: floor.id,
        }))
      : geometry.rooms.flatMap((room, index) =>
          room.spaceKind === 'balcony' ||
          room.spaceKind === 'loggia' ||
          /балкон|лоджи/i.test(room.name)
            ? [
                {
                  id: `plan-space:${index}`,
                  title: room.name,
                  floor: room.polygon,
                  sourceOnly: true,
                },
              ]
            : [],
        ),
    ...(furniture.length > 0 ? { furniture } : {}),
    ...(floorZones.length > 0 ? { floorZones } : {}),
    ...(reference && surfaces
      ? {
          floorSurfaces: surfaces,
          thresholds,
          verticalDatum: {
            id: reference.id,
            kind: reference.kind,
            zeroFloorId: reference.zeroFloorId,
          },
          layoutNote:
            'Показаны только подтверждённые поверхности помещений и известные поверхности порогов. Области между ними не достраиваются плитой на нуле; толщина пола и порогов не задана.',
        }
      : {}),
  }
}

function surfacePolygon(surface: VolumeFloorSurface): Polygon {
  return [surface.floor, ...surface.voids].map((ring) =>
    ring.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
  )
}

function polygonBody(polygon: PlanPoint[]): Polygon {
  return [polygon.map(({ xCm, yCm }) => [xCm, yCm] as [number, number])]
}

function openingEndpoints(geometry: PlanGeometry, id: string): [PlanPoint, PlanPoint] | undefined {
  const bindings = currentOpeningFacePairs(geometry).flatMap((pair) => pair.bindings)
  for (const proof of currentOpeningWidthProofs(geometry)) {
    bindings.push(proof)
    if (proof.oppositeBinding) bindings.push(proof.oppositeBinding)
  }
  const cuts = bindings
    .filter((binding) => binding.opening.id === id && binding.cut)
    .map((binding) => binding.cut)
  const first = cuts[0]
  if (first) {
    const same = (a: PlanPoint, b: PlanPoint) => a.xCm === b.xCm && a.yCm === b.yCm
    if (
      cuts.some(
        (other) =>
          !other ||
          !(
            (same(first[0], other[0]) && same(first[1], other[1])) ||
            (same(first[0], other[1]) && same(first[1], other[0]))
          ),
      )
    )
      return undefined
    return first
  }
  const opening = geometry.openings.find((opening) => opening.id === id)
  const wall = geometry.walls.find((wall) => wall.id === opening?.wallId)
  if (!opening || !wall) return undefined
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  if (!length) return undefined
  return [
    interpolate(wall.start, wall.end, opening.offsetCm / length),
    interpolate(wall.start, wall.end, (opening.offsetCm + opening.widthCm) / length),
  ]
}

/** Known paired straight faces only; no enclosing rectangle for an unverified threshold. */
function thresholdPolygon(
  first: [PlanPoint, PlanPoint],
  second: [PlanPoint, PlanPoint],
): PlanPoint[] | undefined {
  const axis =
    first[0].yCm === first[1].yCm && second[0].yCm === second[1].yCm
      ? 'xCm'
      : first[0].xCm === first[1].xCm && second[0].xCm === second[1].xCm
        ? 'yCm'
        : undefined
  if (!axis) return undefined
  const a = [...first].sort((a, b) => a[axis] - b[axis])
  const b = [...second].sort((a, b) => a[axis] - b[axis])
  if (!a[0] || !a[1] || !b[0] || !b[1] || a[0][axis] !== b[0][axis] || a[1][axis] !== b[1][axis])
    return undefined
  const across = axis === 'xCm' ? 'yCm' : 'xCm'
  if (a[0][across] === b[0][across] || a[0][axis] === a[1][axis]) return undefined
  return [a[0], a[1], b[1], b[0]].map((point) => ({ ...point }))
}

/** The strip must be outside both physical floors, between their facing boundary edges. */
function thresholdFacesInward(
  first: [PlanPoint, PlanPoint],
  second: [PlanPoint, PlanPoint],
  firstRoom: PlanPoint[],
  secondRoom: PlanPoint[],
): boolean {
  const along = first[0].yCm === first[1].yCm ? 'xCm' : 'yCm'
  const across = along === 'xCm' ? 'yCm' : 'xCm'
  const side = (cut: [PlanPoint, PlanPoint], room: PlanPoint[]) => {
    const area = room.reduce((sum, point, index) => {
      const next = room[(index + 1) % room.length]
      return next ? sum + point.xCm * next.yCm - next.xCm * point.yCm : sum
    }, 0)
    const low = Math.min(cut[0][along], cut[1][along])
    const high = Math.max(cut[0][along], cut[1][along])
    const edges = room.flatMap((start, index) => {
      const end = room[(index + 1) % room.length]
      if (
        !end ||
        start[across] !== cut[0][across] ||
        end[across] !== cut[0][across] ||
        Math.min(start[along], end[along]) > low ||
        Math.max(start[along], end[along]) < high
      )
        return []
      return [Math.sign(area) * Math.sign(end[along] - start[along])]
    })
    return edges.length === 1 ? edges[0] : undefined
  }
  const direction = Math.sign(second[0][across] - first[0][across])
  const expected = along === 'xCm' ? -direction : direction
  return (
    direction !== 0 && side(first, firstRoom) === expected && side(second, secondRoom) === -expected
  )
}
