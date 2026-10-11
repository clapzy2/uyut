import { compareDecimalSums, integerPoints } from '@uyut/catalog/plan-exact-geometry'
import { currentOpeningWidthProofs } from '@uyut/catalog/plan-opening-face-pairs'
import { planOpeningEndpoints } from '@uyut/catalog/plan-threshold-geometry'
import { signedPlanFloors } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import type { Polygon } from 'polygon-clipping'
import { doorLeafBlocks, inspectFurnitureDoorLeaves } from './plan-furniture-door-leaves'
import {
  furnitureExteriorOpeningWitness,
  inspectFurnitureExteriorIngress,
} from './plan-furniture-exterior'
import {
  type FurnitureStairTransferResult,
  furnitureStairSurveySchema,
  inspectFurnitureStairTransfer,
} from './plan-furniture-stair-transfer'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'
import { enclosingDecimalSum } from './plan-transfer-enclosure'
import { inspectTransferWallSolids } from './plan-transfer-wall-solids'

type Profile = {
  widthCm: number
  depthCm: number
  heightCm: number
  clearanceCm: number
  orientation: 0 | 90
}
type Position = PlanPoint & { zCm: number; orientation?: 0 | 90 }
export type FurnitureDeliveryResult = {
  points: Position[]
  stairs: FurnitureStairTransferResult
  segments: { entry: Position[]; stairs: Position[]; exit: Position[]; exterior?: Position[] }
  exteriorChecked?: boolean
  leavesChecked?: boolean
  targetRoomId: string
  checkedNodes: number
}
const samePosition = (first: Position, second: Position) =>
  first.xCm === second.xCm &&
  first.yCm === second.yCm &&
  first.zCm === second.zCm &&
  (first.orientation ?? 0) === (second.orientation ?? 0)

/** Continuous measured route; exterior and leaves are opt-in, never inferred. */
export function inspectFurnitureDeliveryViaStairs(
  geometry: PlanGeometry,
  surveyInput: unknown,
  profile: Profile,
  targetRoomId: string,
  accessInput?: { exterior?: unknown; doorLeaves?: unknown },
): { error?: string; notes: string[]; result?: FurnitureDeliveryResult } {
  const notes = [
    'Проверяется единый внутренний путь от площадки выбранной стартовой двери через обмеренную лестницу до целевой комнаты. Пространство перед дверью, наружный порог и сам внешний занос не объявляются проверенными.',
    'Все стыки совпадают по X/Y/Z и положению габарита: между отдельными проверками нет прыжков. Наклон на лестнице выполняется только на площадках; участки квартиры проходят в исходной вертикальной позе.',
    'Масса, устойчивость и работа грузчиков не проверяются. Отсутствие построенного пути не доказывает невозможность другого манёвра.',
    'Створки дверей, их движение и подвижная мебель не включены в проверяемый объём. Свободный проём в модели не подтверждает освобождение этих рабочих зон на объекте.',
  ]
  const fail = (error: string) => ({ error, notes })
  try {
    if (
      accessInput !== undefined &&
      (!accessInput ||
        typeof accessInput !== 'object' ||
        Array.isArray(accessInput) ||
        Object.keys(accessInput).some((key) => key !== 'exterior' && key !== 'doorLeaves'))
    )
      return fail('Не распознаны включённые обмеры наружного заноса и створок.')
    if (
      !/^\d+$/u.test(targetRoomId) ||
      String(Number(targetRoomId)) !== targetRoomId ||
      !geometry.rooms[Number(targetRoomId)]
    )
      return fail('Выберите существующую целевую комнату.')
    const parsed = furnitureStairSurveySchema.safeParse(surveyInput)
    if (!parsed.success) return fail('Сначала нужны полные подтверждённые обмеры лестницы.')
    const exteriorRequested = accessInput?.exterior !== undefined
    const leavesRequested = accessInput?.doorLeaves !== undefined
    if (exteriorRequested && !leavesRequested)
      return fail('Для наружного заноса нужны подтверждённые обмеры всех дверных створок.')
    const leaves = leavesRequested
      ? inspectFurnitureDoorLeaves(geometry, accessInput?.doorLeaves)
      : undefined
    if (leaves?.error) return fail(leaves.error)
    const exteriorOpeningWitness = exteriorRequested
      ? furnitureExteriorOpeningWitness(geometry, accessInput?.exterior)
      : undefined
    const blockedVolume = leaves
      ? (bounds: [number, number, number, number], bottom: number, top: number) =>
          doorLeafBlocks(leaves.volumes, bounds, bottom, top)
      : undefined
    if (leaves)
      notes[3] =
        'Проверяются измеренные объёмы всех дверных створок: фиксированная открытая поза либо консервативный объём всего движения. Открывание, удержание двери и усилия не проверяются.'
    const stairResponse = inspectFurnitureStairTransfer(
      geometry,
      surveyInput,
      profile,
      blockedVolume || exteriorOpeningWitness
        ? { blockedVolume, exteriorOpeningWitness }
        : undefined,
    )
    if (!stairResponse.result)
      return fail(stairResponse.error ?? 'Путь по лестнице не подтверждён.')
    const stairs = stairResponse.result
    const start = stairs.points[0]
    const end = stairs.points.at(-1)
    const signed = signedPlanFloors(geometry)
    if (!signed?.ok || !start || !end)
      return fail('Не подтверждены конечные площадки и общий отсчёт.')
    const survey = parsed.data
    const firstFloorId = survey.travelDirection === 'up' ? survey.lowerFloorId : survey.upperFloorId
    const finalFloorId = survey.travelDirection === 'up' ? survey.upperFloorId : survey.lowerFloorId
    const floorRoom = (floorId: string) => {
      const floor = signed.reference.floors.find((floor) => floor.id === floorId)
      return geometry.rooms.findIndex(
        (room) =>
          floor &&
          room.name === floor.room.name &&
          room.polygon.length === floor.room.polygon.length &&
          room.polygon.every((point, index) => {
            const other = floor.room.polygon[index]
            return other?.xCm === point.xCm && other.yCm === point.yCm
          }),
      )
    }
    const firstRoom = floorRoom(firstFloorId)
    if (firstRoom < 0 || floorRoom(finalFloorId) < 0)
      return fail('Площадки потеряли привязку к комнатам.')
    const width = profile.orientation === 0 ? profile.widthCm : profile.depthCm
    const depth = profile.orientation === 0 ? profile.depthCm : profile.widthCm
    const body = {
      widthCm: enclosingDecimalSum([width, profile.clearanceCm, profile.clearanceCm]),
      depthCm: enclosingDecimalSum([depth, profile.clearanceCm, profile.clearanceCm]),
      heightCm: enclosingDecimalSum([profile.heightCm, profile.clearanceCm]),
    }
    const entryProofs = currentOpeningWidthProofs(geometry).filter(
      (proof) => proof.opening.id === geometry.routeStartOpeningId,
    )
    const cut = planOpeningEndpoints(geometry, geometry.routeStartOpeningId ?? '')
    if (entryProofs.length !== 1 || !cut)
      return fail('Нужна сверенная стартовая дверь с исходными концами.')
    const [a, b, dimensions] = integerPoints([...cut, { xCm: body.widthCm, yCm: body.depthCm }])
    if (!a || !b || !dimensions) return fail('Не удалось проверить габарит стартовой двери.')
    const dx = b.x - a.x
    const dy = b.y - a.y
    const absolute = (value: bigint) => (value < 0n ? -value : value)
    if (dimensions.x * absolute(dx) + dimensions.y * absolute(dy) > dx * dx + dy * dy)
      return fail('Проекция вертикального габарита шире подтверждённого стартового проёма.')
    const wallModel = inspectTransferWallSolids(geometry, exteriorOpeningWitness)
    if (wallModel.error) return fail(wallModel.error)
    const solidsAt = (base: number): Polygon[] => [
      ...wallModel.solids,
      ...wallModel.openings
        .filter(
          (opening) =>
            opening.bottomTerms.length !== 2 ||
            opening.topTerms.length !== 2 ||
            opening.thresholdElevationCm === undefined ||
            opening.thresholdElevationCm > base ||
            opening.bottomTerms.some((terms) => compareDecimalSums([base], terms) < 0) ||
            opening.topTerms.some((terms) => compareDecimalSums([base, body.heightCm], terms) > 0),
        )
        .map((opening) => opening.polygon),
    ]
    const budget = 6000
    const stairWork = stairs.checkedStages ?? stairs.stages.length
    if (stairWork >= budget) return fail('Исчерпан общий бюджет проверки переноса.')
    const entryInspection = inspectPdfClearanceRoutes(geometry, {
      ...body,
      goal: { roomId: String(firstRoom), point: start },
      ...(exteriorOpeningWitness ? { exteriorOpeningWitness } : {}),
      extraSolids: solidsAt(start.zCm),
      ...(blockedVolume
        ? {
            blockedVolume: (bounds: [number, number, number, number]) =>
              blockedVolume(bounds, start.zCm, enclosingDecimalSum([start.zCm, body.heightCm])),
          }
        : {}),
      maxNodes: budget - stairWork,
    })
    const before = entryInspection.result?.routes.find(
      (route) => route.roomId === String(firstRoom),
    )?.points
    if (!before || before.some((point) => point.zCm === undefined))
      return fail(
        entryInspection.missing ??
          'Не построен непрерывный путь от стартовой двери до начала лестницы.',
      )
    const entry = before.map((point) => ({
      ...point,
      zCm: point.zCm as number,
      ...(survey.allowQuarterTurns ? { orientation: 0 as const } : {}),
    }))
    if (!entry.at(-1) || !samePosition(entry.at(-1) as Position, start))
      return fail('Участок от двери не совпадает с началом лестницы по X/Y/Z.')
    let remaining = budget - stairWork - (entryInspection.result?.checkedNodes ?? budget)
    if (remaining < 1) return fail('Исчерпан общий бюджет проверки переноса.')
    const exteriorInspection =
      exteriorRequested && entry[0] && leaves
        ? inspectFurnitureExteriorIngress(
            geometry,
            accessInput?.exterior,
            body,
            entry[0],
            leaves.volumes,
            remaining - 1,
          )
        : undefined
    if (exteriorRequested && !exteriorInspection?.points)
      return fail(exteriorInspection?.error ?? 'Не подтверждён непрерывный наружный занос.')
    const exterior = exteriorInspection?.points?.map((point) => ({
      ...point,
      ...(survey.allowQuarterTurns ? { orientation: 0 as const } : {}),
    }))
    if (
      exterior &&
      (!exterior.at(-1) || !entry[0] || !samePosition(exterior.at(-1) as Position, entry[0]))
    )
      return fail('Наружный занос не совпадает с внутренним путём по X/Y/Z и положению мебели.')
    remaining -= exteriorInspection?.checkedNodes ?? 0
    if (remaining < 1) return fail('Исчерпан общий бюджет проверки переноса.')
    const exitInspection = inspectPdfClearanceRoutes(geometry, {
      ...body,
      ...(end.orientation === 90 ? { widthCm: body.depthCm, depthCm: body.widthCm } : {}),
      origin: { point: end, floorId: finalFloorId },
      ...(exteriorOpeningWitness ? { exteriorOpeningWitness } : {}),
      goal: { roomId: targetRoomId },
      extraSolids: solidsAt(end.zCm),
      ...(blockedVolume
        ? {
            blockedVolume: (bounds: [number, number, number, number]) =>
              blockedVolume(bounds, end.zCm, enclosingDecimalSum([end.zCm, body.heightCm])),
          }
        : {}),
      maxNodes: remaining,
    })
    const after = exitInspection.result?.routes.find(
      (route) => route.roomId === targetRoomId,
    )?.points
    if (!after || after.some((point) => point.zCm === undefined))
      return fail(
        exitInspection.missing ??
          'Не построен непрерывный путь от конца лестницы до целевой комнаты.',
      )
    const exit = after.map((point) => ({
      ...point,
      zCm: point.zCm as number,
      ...(survey.allowQuarterTurns ? { orientation: end.orientation ?? (0 as const) } : {}),
    }))
    if (!exit[0] || !samePosition(end, exit[0]))
      return fail('Конец лестницы не совпадает с продолжением по X/Y/Z.')
    const points = [
      ...(exterior ?? entry),
      ...(exterior ? entry.slice(1) : []),
      ...stairs.points.slice(1),
      ...exit.slice(1),
    ]
    if (exterior)
      notes[0] =
        'Проверяется единый путь от измеренной наружной площадки через обе грани дверного блока, обмеренную лестницу и до целевой комнаты. Подход до наружной площадки не включён.'
    return {
      notes,
      result: {
        points,
        stairs,
        segments: { entry, stairs: stairs.points, exit, ...(exterior ? { exterior } : {}) },
        ...(exterior ? { exteriorChecked: true } : {}),
        ...(leaves ? { leavesChecked: true } : {}),
        targetRoomId,
        checkedNodes:
          stairWork +
          (exteriorInspection?.checkedNodes ?? 0) +
          (entryInspection.result?.checkedNodes ?? 0) +
          (exitInspection.result?.checkedNodes ?? 0),
      },
    }
  } catch {
    return fail(
      'Не удалось подтвердить весь маршрут. Сверьте исходные грани, уровни и обмеры лестницы.',
    )
  }
}
