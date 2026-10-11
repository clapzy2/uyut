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
import { inspectTransferWallSolids } from './plan-transfer-wall-solids'

const length = z.number().finite().positive().max(10000)
const coordinate = z.number().finite().min(0).max(10000)
const elevation = z.number().finite().min(-600).max(600)
const ceiling = z.number().finite().min(-600).max(1200)
const straightStairSurveyObject = z
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
    allowQuarterTurns: z.boolean().optional(),
  })
  .strict()

const straightStairSurveySchema = straightStairSurveyObject.refine(
  (value) => value.tilt !== 'none' || value.angleDeg === undefined || value.angleDeg === 0,
)

const turningStairSurveySchema = straightStairSurveyObject
  .omit({
    direction: true,
    startCm: true,
    crossStartCm: true,
    widthCm: true,
    lowerLandingLengthCm: true,
    upperLandingLengthCm: true,
    lowerLandingCeilingCm: true,
    upperLandingCeilingCm: true,
    treads: true,
  })
  .extend({
    version: z.literal(2),
    layout: z
      .array(
        z
          .object({
            kind: z.enum(['landing', 'tread']),
            polygon: z.array(z.object({ xCm: coordinate, yCm: coordinate }).strict()).length(4),
            elevationCm: elevation,
            ceilingElevationCm: ceiling,
          })
          .strict(),
      )
      .min(3)
      .max(128),
  })
  .strict()
  .refine((value) => value.tilt !== 'none' || value.angleDeg === undefined || value.angleDeg === 0)

export const furnitureStairSurveySchema = z.union([
  straightStairSurveySchema,
  turningStairSurveySchema,
])
export type FurnitureStairSurvey = z.infer<typeof furnitureStairSurveySchema>
type Profile = {
  widthCm: number
  depthCm: number
  heightCm: number
  clearanceCm: number
  orientation: 0 | 90
}
type Position = PlanPoint & { zCm: number; orientation?: 0 | 90 }
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
  kind: 'lift' | 'translate' | 'lower' | 'tilt' | 'untilt' | 'turn'
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
  checkedStages?: number
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
  if (survey.allowQuarterTurns === true)
    notes[1] +=
      ' Дополнительный поворот габарита на 90° проверяется только целиком внутри промежуточной площадки; отметки ориентации заданы относительно исходной позы.'
  if (survey.version === 2) {
    notes[0] =
      'Проверяется явно обмеренная цепочка прямых участков и поворотных площадок. Это локальный путь между двумя полами; общий маршрут требует отдельного соединения с входом.'
    notes[2] =
      'Поворотные участки задаются отдельными прямоугольными площадками. Винтовые, диагональные и многоэтажные перекрывающиеся контуры не достраиваются; отказ не доказывает невозможность переноса.'
  }
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
    (survey.version === 1
      ? survey.lowerLandingCeilingCm
      : (survey.layout[0]?.ceilingElevationCm ?? Infinity)) > lowerCeiling.elevationCm ||
    (survey.version === 1
      ? survey.upperLandingCeilingCm
      : (survey.layout.at(-1)?.ceilingElevationCm ?? Infinity)) > upperCeiling.elevationCm
  )
    return fail('Нужны разные подтверждённые чистовые полы и известные потолки обеих площадок.')
  let previousElevation = lower.elevationCm
  for (const tread of survey.version === 1 ? survey.treads : []) {
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
    const regions: Region[] = []
    if (survey.version === 2) {
      for (const [index, item] of survey.layout.entries()) {
        const [a, b, c, d] = item.polygon as [PlanPoint, PlanPoint, PlanPoint, PlanPoint]
        if (
          !(
            a.xCm < c.xCm &&
            a.yCm < c.yCm &&
            a.yCm === b.yCm &&
            b.xCm === c.xCm &&
            c.yCm === d.yCm &&
            d.xCm === a.xCm
          )
        )
          return fail(
            'Нужны явно обмеренные прямоугольники по X/Y в порядке: левый верхний, правый верхний, правый нижний, левый нижний угол.',
          )
        if (item.ceilingElevationCm <= item.elevationCm)
          return fail('Каждой ступени и площадке нужна известная отметка потолка выше пола.')
        const previous = regions.at(-1)
        if (previous) {
          if (
            item.elevationCm < previous.elevationCm ||
            (item.kind === 'tread' && item.elevationCm === previous.elevationCm)
          )
            return fail('Цепочка обмеров должна идти снизу вверх без обратных ступеней.')
          const p = previous.polygon[0] as PlanPoint
          const q = previous.polygon[2] as PlanPoint
          const connected =
            ((a.xCm === q.xCm || c.xCm === p.xCm) &&
              Math.max(a.yCm, p.yCm) < Math.min(c.yCm, q.yCm)) ||
            ((a.yCm === q.yCm || c.yCm === p.yCm) &&
              Math.max(a.xCm, p.xCm) < Math.min(c.xCm, q.xCm))
          if (!connected)
            return fail(
              'Соседние обмеренные участки должны иметь общую ненулевую грань; пробелы и касания углами не соединяются.',
            )
        }
        if (
          regions.some(
            (region) =>
              polygonClipping.intersection(polygon(region.polygon), polygon(item.polygon)).length,
          )
        )
          return fail('Обмеренные ступени и площадки не должны перекрываться в плане.')
        regions.push({ ...item, index })
      }
      if (
        regions[0]?.kind !== 'landing' ||
        regions.at(-1)?.kind !== 'landing' ||
        regions[0]?.elevationCm !== lower.elevationCm ||
        regions.at(-1)?.elevationCm !== upper.elevationCm ||
        !regions.some((region) => region.kind === 'tread')
      )
        return fail(
          'Цепочка должна начинаться и заканчиваться площадками на выбранных чистовых полах и содержать ступени.',
        )
    } else {
      let along = survey.startCm
      const crossEnd = exactSum([survey.crossStartCm, survey.widthCm])
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
    }
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
        (region.kind === 'tread' ||
          (survey.version === 2 && region !== firstRegion && region !== lastRegion)) &&
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
    const walls = inspectTransferWallSolids(geometry)
    if (walls.error) return fail(walls.error)
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
    const allowTurns = survey.allowQuarterTurns === true
    let checkedStages = 0
    const certify = (bounds: Bounds) => {
      if (allowTurns) {
        if (checkedStages >= 6000)
          throw new Error('Исчерпан общий бюджет проверки манёвров лестницы.')
        checkedStages += 1
      }
      const body = polygon(rectangle(bounds.leftCm, bounds.topCm, bounds.rightCm, bounds.bottomCm))
      const blockedOpenings = walls.openings.filter(
        (opening) =>
          opening.bottomTerms.length !== 2 ||
          opening.topTerms.length !== 2 ||
          opening.thresholdElevationCm === undefined ||
          compareDecimalSums([bounds.bottomElevationCm], [opening.thresholdElevationCm]) < 0 ||
          opening.bottomTerms.some(
            (terms) => compareDecimalSums([bounds.bottomElevationCm], terms) < 0,
          ) ||
          opening.topTerms.some((terms) => compareDecimalSums([bounds.topElevationCm], terms) > 0),
      )
      if (
        polygonClipping.difference(body, union).length ||
        obstacles.some((obstacle) => polygonClipping.intersection(body, obstacle).length) ||
        walls.solids.some((wall) => polygonClipping.intersection(body, wall).length > 0) ||
        blockedOpenings.some(
          (opening) => polygonClipping.intersection(body, opening.polygon).length > 0,
        )
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
      if (allowTurns && region === endRegion) continue
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
    const points: Position[] = [
      {
        ...start,
        zCm: startRegion.elevationCm,
        ...(allowTurns ? { orientation: 0 as const } : {}),
      },
    ]
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
    const translateTo = (target: PlanPoint) => {
      const base = Math.max(position.zCm, requiredBase(horizontalBounds(position, target)))
      if (base > position.zCm) stage('lift', { ...position, zCm: base })
      stage('translate', { ...target, zCm: base })
      const settled = requiredBase(bodyBounds(target, carried.widthCm, carried.depthCm))
      if (settled < position.zCm) stage('lower', { ...position, zCm: settled })
    }
    if (!allowTurns) {
      for (const region of ordered.slice(1)) {
        const target = centre(region)
        if (survey.version === 1 || position.xCm === target.xCm || position.yCm === target.yCm) {
          translateTo(target)
          continue
        }
        const origin = { ...position }
        const stageCount = stages.length
        const pointCount = points.length
        let accepted = false
        for (const corner of [
          { xCm: target.xCm, yCm: origin.yCm },
          { xCm: origin.xCm, yCm: target.yCm },
        ]) {
          position = { ...origin }
          stages.length = stageCount
          points.length = pointCount
          try {
            translateTo(corner)
            translateTo(target)
            accepted = true
            break
          } catch {
            // Try the other measured-axis bend; no failed partial path is retained.
          }
        }
        if (!accepted)
          throw new Error(
            'Не подтверждён полный габарит на поворотной площадке и обеих соединяющих перемещениях. Вращение мебели в этом режиме не достраивается.',
          )
      }
      if (angleDeg > 0) stage('untilt', position, endpoint)
      if (position.zCm !== endRegion.elevationCm)
        stage('lower', { ...position, zCm: endRegion.elevationCm }, endpoint)
    } else {
      type PathState = { position: Position; points: Position[]; stages: Stage[] }
      const snapshot = (): PathState => ({
        position: { ...position },
        points: [...points],
        stages: [...stages],
      })
      const restore = (state: PathState) => {
        position = { ...state.position }
        points.splice(0, points.length, ...state.points)
        stages.splice(0, stages.length, ...state.stages)
      }
      const shapeAt = (shape: typeof carried, orientation: 0 | 90) =>
        orientation === 0
          ? shape
          : {
              widthCm: shape.depthCm,
              depthCm: shape.widthCm,
              heightCm: shape.heightCm,
            }
      const move = (target: PlanPoint, orientation: 0 | 90) => {
        const shape = shapeAt(carried, orientation)
        const base = Math.max(position.zCm, requiredBase(horizontalBounds(position, target, shape)))
        if (base > position.zCm) stage('lift', { ...position, zCm: base }, shape)
        stage('translate', { ...target, zCm: base, orientation }, shape)
        const settled = requiredBase(bodyBounds(target, shape.widthCm, shape.depthCm))
        if (settled < position.zCm) stage('lower', { ...position, zCm: settled }, shape)
      }
      let states: PathState[] = [snapshot()]
      for (const region of ordered.slice(1)) {
        const target = centre(region)
        const arrivals = new Map<0 | 90, PathState>()
        for (const state of states) {
          const orientation = state.position.orientation ?? 0
          const origin = state.position
          const corners =
            origin.xCm === target.xCm || origin.yCm === target.yCm
              ? [target]
              : [
                  { xCm: target.xCm, yCm: origin.yCm },
                  { xCm: origin.xCm, yCm: target.yCm },
                ]
          for (const corner of corners) {
            restore(state)
            try {
              move(corner, orientation)
              if (corner.xCm !== target.xCm || corner.yCm !== target.yCm) move(target, orientation)
              arrivals.set(orientation, snapshot())
              break
            } catch {
              // A bounded alternative axis ordering; failed partial paths are discarded.
            }
          }
        }
        if (!arrivals.size)
          throw new Error(
            'Не подтверждён полный габарит непрерывного перемещения между площадками и ступенями.',
          )
        const next = new Map(arrivals)
        if (region.kind === 'landing' && region !== endRegion) {
          const side = enclosingTurnSide(carried.widthCm, carried.depthCm)
          const turnBounds = side === undefined ? undefined : bodyBounds(target, side, side)
          const bounds: [number, number, number, number] | undefined = turnBounds
            ? [turnBounds.leftCm, turnBounds.topCm, turnBounds.rightCm, turnBounds.bottomCm]
            : undefined
          if (
            bounds &&
            side !== undefined &&
            polygonClipping.difference(polygon(rectangle(...bounds)), polygon(region.polygon))
              .length === 0
          ) {
            const turnShape = { widthCm: side, depthCm: side, heightCm: carried.heightCm }
            for (const [orientation, state] of arrivals) {
              const turned: 0 | 90 = orientation === 0 ? 90 : 0
              if (next.has(turned)) continue
              restore(state)
              try {
                const base = Math.max(
                  position.zCm,
                  requiredBase({
                    leftCm: bounds[0],
                    topCm: bounds[1],
                    rightCm: bounds[2],
                    bottomCm: bounds[3],
                  }),
                )
                if (base > position.zCm) stage('lift', { ...position, zCm: base }, turnShape)
                stage('turn', { ...position, orientation: turned }, turnShape)
                const shape = shapeAt(carried, turned)
                const settled = requiredBase(bodyBounds(target, shape.widthCm, shape.depthCm))
                if (settled < position.zCm) stage('lower', { ...position, zCm: settled }, shape)
                next.set(turned, snapshot())
              } catch {
                // A turn is not retained unless the whole swept square and head clearance fit.
              }
            }
          }
        }
        states = [...next.values()]
      }
      let completed = false
      for (const state of states) {
        restore(state)
        const shape = shapeAt(endpoint, position.orientation ?? 0)
        const bounds = bodyBounds(position, shape.widthCm, shape.depthCm)
        if (
          polygonClipping.difference(
            polygon(rectangle(bounds.leftCm, bounds.topCm, bounds.rightCm, bounds.bottomCm)),
            polygon(endRegion.polygon),
          ).length
        )
          continue
        try {
          if (angleDeg > 0) stage('untilt', position, shape)
          if (position.zCm !== endRegion.elevationCm)
            stage('lower', { ...position, zCm: endRegion.elevationCm }, shape)
          completed = true
          break
        } catch {
          // Try the other reachable final orientation; no partial lowering is accepted.
        }
      }
      if (!completed)
        throw new Error(
          'Не подтверждены полный разворот наклона и установка габарита на конечной площадке.',
        )
    }
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
        ...(allowTurns ? { checkedStages } : {}),
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
