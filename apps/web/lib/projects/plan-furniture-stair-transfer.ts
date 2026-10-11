import { compareDecimalSums } from '@uyut/catalog/plan-exact-geometry'
import {
  signedElevationSum,
  signedPlanFloors,
  verticalReferenceReviewKey,
} from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { z } from 'zod'
import { tiltedBoxEnvelope } from './plan-tilt-angle-envelope'
import {
  enclosingDecimalSum,
  enclosingTurnBounds,
  enclosingTurnSide,
} from './plan-transfer-enclosure'

const length = z.number().finite().positive().max(10000)
const coordinate = z.number().finite().min(0).max(10000)
const elevation = z.number().finite().min(-600).max(600)
const ceiling = z.number().finite().min(-600).max(1200)
export const furnitureStairSurveySchema = z
  .object({
    version: z.literal(1),
    referenceKey: z.string().min(1).max(1000000),
    geometryKey: z.string().min(1).max(1000000),
    source: z
      .object({
        kind: z.enum(['site-measurement', 'dimensioned-drawing']),
        reference: z.string().trim().min(1).max(1000),
      })
      .strict(),
    lowerFloorId: z.string().min(1).max(100),
    upperFloorId: z.string().min(1).max(100),
    direction: z.enum(['x', 'y']),
    startCm: coordinate,
    crossStartCm: coordinate,
    widthCm: length,
    lowerLandingLengthCm: length,
    upperLandingLengthCm: length,
    lowerLandingCeilingCm: ceiling,
    upperLandingCeilingCm: ceiling,
    treads: z
      .array(
        z.object({ runCm: length, elevationCm: elevation, ceilingElevationCm: ceiling }).strict(),
      )
      .min(1)
      .max(64),
    travelDirection: z.enum(['up', 'down']),
    carryClearanceCm: z.number().finite().min(0).max(100),
    tilt: z.enum(['none', 'width', 'depth']),
    angleDeg: z.number().finite().min(0).max(90).optional(),
    acknowledged: z.literal(true),
  })
  .strict()
  .refine((value) => value.tilt !== 'none' || value.angleDeg === undefined || value.angleDeg === 0)

export type FurnitureStairSurvey = z.infer<typeof furnitureStairSurveySchema>
type Profile = {
  widthCm: number
  depthCm: number
  heightCm: number
  clearanceCm: number
  orientation: 0 | 90
}
type Position = PlanPoint & { zCm: number }
type Bounds = {
  leftCm: number
  topCm: number
  rightCm: number
  bottomCm: number
  bottomElevationCm: number
  topElevationCm: number
}
type Region = {
  kind: 'landing' | 'tread'
  index: number
  polygon: PlanPoint[]
  elevationCm: number
  ceilingElevationCm: number
}
type Stage = {
  kind: 'lift' | 'translate' | 'lower' | 'tilt' | 'untilt'
  from: Position
  to: Position
  bounds: Bounds
}
export type FurnitureStairTransferResult = {
  referenceId: string
  travelDirection: 'up' | 'down'
  tilt: FurnitureStairSurvey['tilt']
  angleDeg: number
  carried: { widthCm: number; depthCm: number; heightCm: number }
  sweepHeightCm: number
  regions: Region[]
  points: Position[]
  stages: Stage[]
}

/** Exact current request context, not recognition or independent measurement evidence. */
export function furnitureStairGeometryKey(geometry: PlanGeometry): string {
  return JSON.stringify(geometry)
}
const polygon = (points: PlanPoint[]): Polygon => [points.map(({ xCm, yCm }) => [xCm, yCm])]
function rectangle(left: number, top: number, right: number, bottom: number): PlanPoint[] {
  return [
    { xCm: left, yCm: top },
    { xCm: right, yCm: top },
    { xCm: right, yCm: bottom },
    { xCm: left, yCm: bottom },
  ]
}
function exactSum(values: number[]): number {
  const result = values.reduce(signedElevationSum, 0)
  if (!Number.isFinite(result) || compareDecimalSums([result], values) !== 0)
    throw new Error('Не удалось точно сохранить введённые границы марша.')
  return result
}
function bodyBounds(point: PlanPoint, width: number, depth: number) {
  const horizontal = enclosingTurnBounds(point, width, 0, width)
  const vertical = enclosingTurnBounds(point, depth, 0, depth)
  if (!horizontal || !vertical)
    throw new Error('Не удалось подтвердить численное ограждение габарита.')
  return {
    leftCm: horizontal[0],
    topCm: vertical[1],
    rightCm: horizontal[2],
    bottomCm: vertical[3],
  }
}
function horizontalWallBounds(start: PlanPoint, end: PlanPoint, thickness: number) {
  const first = bodyBounds(start, thickness, thickness)
  const last = bodyBounds(end, thickness, thickness)
  return {
    leftCm: Math.min(first.leftCm, last.leftCm),
    topCm: Math.min(first.topCm, last.topCm),
    rightCm: Math.max(first.rightCm, last.rightCm),
    bottomCm: Math.max(first.bottomCm, last.bottomCm),
  }
}

/** Local measured straight-flight certificate only; no external delivery or load-bearing claim. */
export function inspectFurnitureStairTransfer(
  geometry: PlanGeometry,
  input: unknown,
  profile: Profile,
): { error?: string; notes: string[]; result?: FurnitureStairTransferResult } {
  const notes = [
    'Проверяется только явно обмеренный прямой марш и две площадки. Это отдельный локальный путь, а не доставка от входной двери квартиры.',
    'Проверяется весь непрерывный габарит подъёма, наклона и перемещения; стены и неподвижные предметы считаются препятствиями на любой высоте. Вес, устойчивость, опора, люди и возможность подъёма не проверяются.',
    'Повороты марша, винтовые лестницы, диагональные марши и многоэтажные перекрывающиеся контуры здесь не построены. Отказ консервативной проверки не доказывает невозможность переноса.',
  ]
  const fail = (error: string) => ({ error, notes })
  const parsed = furnitureStairSurveySchema.safeParse(input)
  if (!parsed.success)
    return fail('Нужны полные обмеры прямого марша, потолков и площадок с явным подтверждением.')
  if (
    !profile ||
    ![profile.widthCm, profile.depthCm, profile.heightCm, profile.clearanceCm].every(
      Number.isFinite,
    ) ||
    profile.widthCm <= 0 ||
    profile.widthCm > 1000 ||
    profile.depthCm <= 0 ||
    profile.depthCm > 1000 ||
    profile.heightCm <= 0 ||
    profile.heightCm > 600 ||
    profile.clearanceCm < 0 ||
    profile.clearanceCm > 100 ||
    ![0, 90].includes(profile.orientation)
  )
    return fail('Проверьте все размеры переносимого габарита и явный запас.')
  const signed = signedPlanFloors(geometry)
  if (!signed?.ok)
    return fail(
      signed && !signed.ok ? signed.error : 'Нужны подтверждённый общий отсчёт и чистовые полы.',
    )
  const survey = parsed.data
  const geometryKey = furnitureStairGeometryKey(geometry)
  if (
    geometryKey.length > 1000000 ||
    survey.geometryKey !== geometryKey ||
    survey.referenceKey !== verticalReferenceReviewKey(signed.reference)
  )
    return fail('Схема или высотный отсчёт изменились: повторно сверьте обмеры марша.')
  const lower = signed.reference.floors.find((floor) => floor.id === survey.lowerFloorId)
  const upper = signed.reference.floors.find((floor) => floor.id === survey.upperFloorId)
  const lowerCeiling = signed.reference.ceilings?.find((item) => item.floorId === lower?.id)
  const upperCeiling = signed.reference.ceilings?.find((item) => item.floorId === upper?.id)
  if (
    !lower ||
    !upper ||
    lower.id === upper.id ||
    lower.surface !== 'finished-floor' ||
    upper.surface !== 'finished-floor' ||
    lower.elevationCm >= upper.elevationCm ||
    !lowerCeiling ||
    !upperCeiling ||
    survey.lowerLandingCeilingCm > lowerCeiling.elevationCm ||
    survey.upperLandingCeilingCm > upperCeiling.elevationCm
  )
    return fail('Нужны разные подтверждённые чистовые полы и известные потолки обеих площадок.')
  let previousElevation = lower.elevationCm
  for (const tread of survey.treads) {
    if (
      tread.elevationCm <= previousElevation ||
      tread.elevationCm >= upper.elevationCm ||
      tread.ceilingElevationCm <= tread.elevationCm
    )
      return fail(
        'Отметки ступеней должны строго возрастать между нижним и верхним чистовыми полами; потолки задаются отдельно.',
      )
    previousElevation = tread.elevationCm
  }
  try {
    let along = survey.startCm
    const crossEnd = exactSum([survey.crossStartCm, survey.widthCm])
    const regions: Region[] = []
    const appendRegion = (kind: Region['kind'], run: number, floor: number, head: number) => {
      const end = exactSum([along, run])
      if (end > 10000 || crossEnd > 10000 || head <= floor)
        throw new Error('Границы или потолок марша выходят за поддерживаемые обмеры.')
      const vertices =
        survey.direction === 'x'
          ? rectangle(along, survey.crossStartCm, end, crossEnd)
          : rectangle(survey.crossStartCm, along, crossEnd, end)
      regions.push({
        kind,
        index: regions.length,
        polygon: vertices,
        elevationCm: floor,
        ceilingElevationCm: head,
      })
      along = end
    }
    appendRegion(
      'landing',
      survey.lowerLandingLengthCm,
      lower.elevationCm,
      survey.lowerLandingCeilingCm,
    )
    for (const tread of survey.treads)
      appendRegion('tread', tread.runCm, tread.elevationCm, tread.ceilingElevationCm)
    appendRegion(
      'landing',
      survey.upperLandingLengthCm,
      upper.elevationCm,
      survey.upperLandingCeilingCm,
    )
    const firstRegion = regions[0] as Region
    const lastRegion = regions.at(-1) as Region
    const surfaceBody = (floorId: string): Polygon[] =>
      signed.surfaces
        .filter((surface) => surface.floorId === floorId)
        .map((surface) => [
          surface.floor.map(({ xCm, yCm }) => [xCm, yCm]),
          ...surface.voids.map((hole) =>
            hole.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
          ),
        ])
    const ownedLanding = (region: Region, floorId: string) => {
      const surfaces = surfaceBody(floorId)
      return (
        !!surfaces[0] &&
        polygonClipping.difference(
          polygon(region.polygon),
          polygonClipping.union(surfaces[0], ...surfaces.slice(1)),
        ).length === 0
      )
    }
    if (!ownedLanding(firstRegion, lower.id) || !ownedLanding(lastRegion, upper.id))
      return fail(
        'Каждая площадка должна целиком лежать на соответствующем подтверждённом чистовом полу.',
      )
    const extent = polygon(geometry.footprint as PlanPoint[])
    const voids = (geometry.voids ?? []).map((item) => polygon(item.polygon))
    for (const region of regions) {
      const regionBody = polygon(region.polygon)
      if (
        polygonClipping.difference(regionBody, extent).length ||
        voids.some((hole) => polygonClipping.intersection(regionBody, hole).length)
      )
        return fail(
          'Обмеренный марш выходит за сверенную границу или пересекает записанную пустоту.',
        )
      if (
        region.kind === 'tread' &&
        signed.reference.floors.some(
          (floor) =>
            polygonClipping.intersection(regionBody, polygon(floor.room.polygon)).length > 0,
        )
      )
        return fail('Ступени перекрывают записанный физический пол; сначала уточните схему.')
    }
    const regionBodies = regions.map((region) => polygon(region.polygon))
    const union = polygonClipping.union(regionBodies[0] as Polygon, ...regionBodies.slice(1))
    const angleDeg = survey.tilt === 'none' ? 0 : (survey.angleDeg ?? 90)
    const clearance = profile.clearanceCm
    const upright = {
      widthCm: enclosingDecimalSum([profile.widthCm, clearance, clearance]),
      depthCm: enclosingDecimalSum([profile.depthCm, clearance, clearance]),
      heightCm: enclosingDecimalSum(
        angleDeg > 0 ? [profile.heightCm, clearance, clearance] : [profile.heightCm, clearance],
      ),
    }
    const dimension = survey.tilt === 'depth' ? upright.depthCm : upright.widthCm
    const pose = tiltedBoxEnvelope(dimension, upright.heightCm, angleDeg)
    const diagonal =
      angleDeg > 0 ? enclosingTurnSide(dimension, upright.heightCm) : upright.heightCm
    if (!pose || diagonal === undefined) return fail('Не удалось подтвердить наклонённый габарит.')
    const carried = { ...upright, heightCm: pose.heightCm }
    const endpoint = { ...upright, heightCm: diagonal }
    if (survey.tilt === 'width') {
      carried.widthCm = pose.extentCm
      endpoint.widthCm = angleDeg > 0 ? diagonal : upright.widthCm
    }
    if (survey.tilt === 'depth') {
      carried.depthCm = pose.extentCm
      endpoint.depthCm = angleDeg > 0 ? diagonal : upright.depthCm
    }
    if (profile.orientation === 90) {
      ;[carried.widthCm, carried.depthCm] = [carried.depthCm, carried.widthCm]
      ;[endpoint.widthCm, endpoint.depthCm] = [endpoint.depthCm, endpoint.widthCm]
    }
    const fixedItems = [...(geometry.obstacles ?? []), ...(geometry.kitchenItems ?? [])]
    if (
      fixedItems.some(
        (item) =>
          ![item.xCm, item.yCm, item.widthCm, item.depthCm].every(Number.isFinite) ||
          item.widthCm <= 0 ||
          item.depthCm <= 0,
      )
    )
      return fail('Проверьте конечные положительные размеры всех неподвижных препятствий.')
    const obstacles = fixedItems.map((item) =>
      polygon(
        rectangle(
          item.xCm,
          item.yCm,
          exactSum([item.xCm, item.widthCm]),
          exactSum([item.yCm, item.depthCm]),
        ),
      ),
    )
    const wallSolids: Polygon[] = []
    if (geometry.pdfCalibration && geometry.walls.length)
      return fail(
        'Исходные грани стен PDF не являются физическими осями. Для марша нужна отдельная проверка полных стен; толщина не превращает грань в ось.',
      )
    for (const wall of geometry.walls) {
      if (
        !wall.start ||
        !wall.end ||
        ![wall.start.xCm, wall.start.yCm, wall.end.xCm, wall.end.yCm].every(Number.isFinite) ||
        (wall.start.xCm === wall.end.xCm && wall.start.yCm === wall.end.yCm)
      )
        return fail('Не подтверждены конечные координаты физических осей стен.')
      const thickness = wall.measuredThicknessCm
      if (
        thickness === undefined ||
        !Number.isFinite(thickness) ||
        thickness <= 0 ||
        thickness > 100
      )
        return fail(
          'Физическая толщина и ось каждой стены должны быть отдельно сверены; неизвестные стены не заменяются линиями.',
        )
      const bounds = horizontalWallBounds(wall.start, wall.end, thickness)
      wallSolids.push(
        polygon(rectangle(bounds.leftCm, bounds.topCm, bounds.rightCm, bounds.bottomCm)),
      )
    }
    const touched = (bounds: ReturnType<typeof bodyBounds>) =>
      regions.filter((region) => {
        const box = region.polygon
        const a = box[0] as PlanPoint
        const b = box[2] as PlanPoint
        return (
          bounds.rightCm > a.xCm &&
          bounds.leftCm < b.xCm &&
          bounds.bottomCm > a.yCm &&
          bounds.topCm < b.yCm
        )
      })
    const horizontalBounds = (from: PlanPoint, to: PlanPoint, shape = carried) => {
      const a = bodyBounds(from, shape.widthCm, shape.depthCm)
      const b = bodyBounds(to, shape.widthCm, shape.depthCm)
      return {
        leftCm: Math.min(a.leftCm, b.leftCm),
        topCm: Math.min(a.topCm, b.topCm),
        rightCm: Math.max(a.rightCm, b.rightCm),
        bottomCm: Math.max(a.bottomCm, b.bottomCm),
      }
    }
    const certify = (bounds: Bounds) => {
      const body = polygon(rectangle(bounds.leftCm, bounds.topCm, bounds.rightCm, bounds.bottomCm))
      if (
        polygonClipping.difference(body, union).length ||
        obstacles.some((obstacle) => polygonClipping.intersection(body, obstacle).length) ||
        wallSolids.some((wall) => polygonClipping.intersection(body, wall).length > 0)
      )
        throw new Error(
          'Весь непрерывный габарит выходит из измеренного марша или пересекает стену/неподвижный предмет.',
        )
      const owners = touched(bounds)
      if (
        !owners.length ||
        owners.some(
          (region) =>
            compareDecimalSums([bounds.bottomElevationCm], [region.elevationCm]) < 0 ||
            compareDecimalSums([bounds.topElevationCm], [region.ceilingElevationCm]) > 0,
        )
      )
        throw new Error(
          'Полный габарит задевает ступень либо известный потолок; перенос не подтверждён.',
        )
    }
    const requiredBase = (bounds: ReturnType<typeof bodyBounds>) => {
      const owners = touched(bounds)
      if (!owners.length) throw new Error('Под габаритом нет измеренной поверхности марша.')
      return enclosingDecimalSum([
        Math.max(...owners.map((region) => region.elevationCm)),
        survey.carryClearanceCm,
      ])
    }
    const centre = (region: Region): PlanPoint => {
      const first = region.polygon[0]
      const opposite = region.polygon[2]
      if (!first || !opposite) throw new Error('Не найдены измеренные границы площадки.')
      return { xCm: (first.xCm + opposite.xCm) / 2, yCm: (first.yCm + opposite.yCm) / 2 }
    }
    const ordered = survey.travelDirection === 'up' ? regions : [...regions].reverse()
    const startRegion = ordered[0] as Region
    const endRegion = ordered.at(-1) as Region
    const start = centre(startRegion)
    const finish = centre(endRegion)
    for (const [point, region] of [
      [start, startRegion],
      [finish, endRegion],
    ] as const) {
      const bounds = bodyBounds(point, endpoint.widthCm, endpoint.depthCm)
      if (
        polygonClipping.difference(
          polygon(rectangle(bounds.leftCm, bounds.topCm, bounds.rightCm, bounds.bottomCm)),
          polygon(region.polygon),
        ).length
      )
        return fail('Вся область подъёма и наклона должна лежать на одной измеренной площадке.')
    }
    const stages: Stage[] = []
    const points: Position[] = [{ ...start, zCm: startRegion.elevationCm }]
    let position = points[0] as Position
    const stage = (kind: Stage['kind'], to: Position, shape = carried) => {
      const bounds = {
        ...horizontalBounds(position, to, shape),
        bottomElevationCm: Math.min(position.zCm, to.zCm),
        topElevationCm: enclosingDecimalSum([Math.max(position.zCm, to.zCm), shape.heightCm]),
      }
      certify(bounds)
      stages.push({ kind, from: { ...position }, to: { ...to }, bounds })
      points.push({ ...to })
      position = { ...to }
    }
    const startingBase = requiredBase(bodyBounds(start, carried.widthCm, carried.depthCm))
    if (startingBase !== position.zCm) stage('lift', { ...position, zCm: startingBase }, endpoint)
    if (angleDeg > 0) stage('tilt', position, endpoint)
    for (const region of ordered.slice(1)) {
      const target = centre(region)
      const base = Math.max(position.zCm, requiredBase(horizontalBounds(position, target)))
      if (base > position.zCm) stage('lift', { ...position, zCm: base })
      stage('translate', { ...target, zCm: base })
      const settled = requiredBase(bodyBounds(target, carried.widthCm, carried.depthCm))
      if (settled < position.zCm) stage('lower', { ...position, zCm: settled })
    }
    if (angleDeg > 0) stage('untilt', position, endpoint)
    if (position.zCm !== endRegion.elevationCm)
      stage('lower', { ...position, zCm: endRegion.elevationCm }, endpoint)
    if (!stages.length) return fail('Не удалось построить непрерывный путь по маршу.')
    return {
      notes,
      result: {
        referenceId: signed.reference.id,
        travelDirection: survey.travelDirection,
        tilt: survey.tilt,
        angleDeg,
        carried,
        sweepHeightCm: diagonal,
        regions,
        points,
        stages,
      },
    }
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : 'Не удалось подтвердить непрерывный перенос по измеренному маршу.',
    )
  }
}
