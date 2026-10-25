import { kitchenClearanceZones } from '@uyut/catalog/geometry'
import {
  inspectPlanThresholdSurfaces,
  planOpeningEndpoints,
} from '@uyut/catalog/plan-threshold-geometry'
import type {
  OpeningSpan,
  PlanSolidFace,
  PlanVolume,
  VolumeFloorSurface,
  VolumeFloorZone,
  VolumeFurniture,
  WallSpan,
} from '@uyut/catalog/plan-volume-types'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { kitchenItemIssues, kitchenItemsSchema, kitchenLabels } from './kitchen-items'
import type { PlanGeometryIssue } from './plan-geometry-inspection'
import { currentWallFacePairs } from './plan-opening-face-pairs'
import { currentSourceOpeningIds } from './plan-opening-measurements'
import {
  inspectPlanVerticalDimensions,
  planVerticalMeasurementReport,
} from './plan-vertical-dimensions'
import { signedElevationSum, signedPlanFloors } from './plan-vertical-floor-geometry'
import { wallElevationPanels } from './wall-elevation'
import { wallSolidFaces } from './wall-solid'
import { joinWallSolids } from './wall-solid-union'

export type {
  OpeningSpan,
  PlanSolidFace,
  PlanVolume,
  VolumeFloorSurface,
  VolumeFloorZone,
  VolumeFurniture,
  VolumeRoom,
  VolumeThreshold,
  WallSpan,
} from '@uyut/catalog/plan-volume-types'

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
  if (geometry.pdfCalibration?.floorScope?.kind === 'partial') return null
  if (geometry.pdfCalibration?.sourceState === 'proposed') return null
  if (geometry.requiresSourceReviewReimport) return null
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
    // A reviewed finished-floor surface can be viewed on its own. Do not draw
    // walls from the footprint when the PDF has no proven wall-face pairs.
    if (sourcePairs.length === 0 && (!reference || signed?.surfaces.length === 0)) return null
    if (currentPairs.length !== sourcePairs.length) return null

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
    const pairedJambOpeningIds = currentSourceOpeningIds(geometry)
    for (const opening of projectedOpenings) {
      if (!provenOpeningIds.has(opening.id)) continue
      const wall = geometry.walls.find((candidate) => candidate.id === opening.wallId)
      if (!wall) return null
      const floor = wallFloors.get(wall.id)
      if (reference && !floor) return null
      const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
      if (length <= 0 || opening.offsetCm < 0 || opening.offsetCm + opening.widthCm > length + 1e-7)
        return null
      const endpoints = reference ? planOpeningEndpoints(geometry, opening.id) : undefined
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
      // Source face intervals already stop at the gap. Without current jamb and
      // width evidence, even an uncut marker would render an authoritative void.
      if (!pairedJambOpeningIds.has(opening.id)) return null
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
  const thresholdReport = reference ? inspectPlanThresholdSurfaces(geometry) : undefined
  const thresholds = thresholdReport?.surfaces
  levelIssues.push(...(thresholdReport?.issues ?? []))
  if (geometry.pdfCalibration && walls.length === 0) {
    levelIssues.push({
      id: 'volume-pdf-wall-faces-unverified',
      severity: 'warning',
      message:
        'Показан только подтверждённый пол. Физические грани стен и проёмы пока не доказаны.',
    })
  }
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

/**
 * Why a plan has no 3D view, in the order planVolume checks it. A missing level is
 * named as missing: no conditional zero, height or threshold is offered instead.
 */
export function planVolumeBlocker(geometry: PlanGeometry): string | undefined {
  if (geometry.pdfCalibration?.floorScope?.kind === 'partial')
    return `Пол проверен частично: ${geometry.pdfCalibration.floorScope.note} Полный объём не строится.`
  if (geometry.pdfCalibration?.sourceState === 'proposed')
    return 'Проектный 2D-черновик описывает будущие изменения. Полный подтверждённый 3D по нему не строится; отдельный проектный просмотр уровней не заменяет существующий обмер.'
  if (planVolume(geometry)) return undefined
  if (geometry.requiresSourceReviewReimport)
    return 'Разметка исходного PDF изменилась после переноса. Обновите 2D-схему.'
  const signed = signedPlanFloors(geometry)
  if (signed && !signed.ok) return signed.error
  if (geometry.status !== 'confirmed') return 'Объём строится только по подтверждённой 2D-схеме.'
  if (!geometry.footprint || geometry.footprint.length < 3)
    return geometry.pdfCalibration?.exteriorBoundaryRole === 'outer-wall-envelope'
      ? 'Нет сверенной границы чистого пола. Наружная сторона стен её не заменяет: обведите пол по внутренней грани стен на исходном листе.'
      : 'Нет сверенной границы квартиры.'
  const vertical = inspectPlanVerticalDimensions(geometry)[0]
  if (vertical) return vertical.message
  if (!kitchenItemsSchema.safeParse(geometry.kitchenItems ?? []).success)
    return 'Кухонные предметы схемы не прошли проверку.'
  const calibration = geometry.pdfCalibration
  if (calibration) {
    const reference = signed?.ok ? signed.reference : undefined
    if (!reference && calibration.exteriorBoundaryRole !== 'floor')
      return 'Нужен общий отсчёт высот: отметки полов из обмера или размерного чертежа. Подписи высоты потолка их не заменяют, а условный ноль не подставляется.'
    const sourcePairs = calibration.sourceWallFacePairs ?? []
    if (sourcePairs.length === 0 && (!reference || signed?.surfaces.length === 0))
      return 'Грани стен не связаны парами с исходным листом, а подтверждённого чистового пола нет.'
    if (currentWallFacePairs(geometry).length !== sourcePairs.length)
      return 'Стены или проёмы изменились после переноса: связи граней с исходным листом больше не действуют.'
  }
  return 'Стены, проёмы или косяки схемы не прошли проверку объёма.'
}

function surfacePolygon(surface: VolumeFloorSurface): Polygon {
  return [surface.floor, ...surface.voids].map((ring) =>
    ring.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
  )
}

function polygonBody(polygon: PlanPoint[]): Polygon {
  return [polygon.map(({ xCm, yCm }) => [xCm, yCm] as [number, number])]
}
