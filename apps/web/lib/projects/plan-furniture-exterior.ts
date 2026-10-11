import {
  compareDecimalSums,
  cross,
  dot,
  exactSegmentContains,
  integerPoints,
  vector,
} from '@uyut/catalog/plan-exact-geometry'
import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
  currentWallFacePairs,
} from '@uyut/catalog/plan-opening-face-pairs'
import { planOpeningEndpoints } from '@uyut/catalog/plan-threshold-geometry'
import {
  signedPlanFloors,
  verticalReferenceReviewKey,
} from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { z } from 'zod'
import { doorLeafBlocks, type FurnitureDoorLeafVolume } from './plan-furniture-door-leaves'
import { simpleSurveyRing } from './plan-furniture-stair-transfer'
import { inspectSourceClearanceRoutes } from './plan-source-clearance-route'
import { enclosingDecimalSum, enclosingTurnBounds } from './plan-transfer-enclosure'
import { type ExteriorOpeningWitness, inspectTransferWallSolids } from './plan-transfer-wall-solids'

const coordinate = z.number().finite().min(-10000).max(10000)
const point = z.object({ xCm: coordinate, yCm: coordinate }).strict()
const elevation = z.number().finite().min(-600).max(1200)
export const furnitureExteriorIngressSchema = z
  .object({
    version: z.literal(1),
    geometryKey: z.string().min(1).max(1000000),
    referenceKey: z.string().min(1).max(1000000),
    source: z
      .object({
        kind: z.enum(['site-measurement', 'dimensioned-drawing']),
        reference: z.string().trim().min(1).max(1000),
      })
      .strict(),
    acknowledged: z.literal(true),
    openingId: z.string().min(1).max(100),
    outerWallId: z.string().min(1).max(100),
    outerCut: z.tuple([point, point]),
    outerBottomElevationCm: elevation,
    outerTopElevationCm: elevation,
    corridorCeilingElevationCm: elevation,
    thresholdElevationCm: elevation,
    carryElevationCm: elevation,
    outside: z
      .object({
        polygon: z.array(point).min(3).max(32),
        start: point,
        elevationCm: elevation,
        ceilingElevationCm: elevation,
      })
      .strict(),
  })
  .strict()
type Position = PlanPoint & { zCm: number; orientation?: 0 | 90 }
type Body = { widthCm: number; depthCm: number; heightCm: number }
/** A raw exterior gate stays out of projected indoor room/floor relations. */
export function furnitureExteriorOpeningWitness(
  geometry: PlanGeometry,
  input: unknown,
): ExteriorOpeningWitness | undefined {
  const parsed = furnitureExteriorIngressSchema.safeParse(input)
  const signed = signedPlanFloors(geometry)
  if (!parsed.success || !signed?.ok || !geometry.pdfCalibration) return undefined
  const survey = parsed.data
  if (
    survey.openingId !== geometry.routeStartOpeningId ||
    survey.geometryKey !== JSON.stringify(geometry) ||
    survey.referenceKey !== verticalReferenceReviewKey(signed.reference)
  )
    return undefined
  const calibration = geometry.pdfCalibration
  const pairs = currentOpeningFacePairs({
    ...geometry,
    pdfCalibration: {
      ...calibration,
      openingFacePairs: calibration.sourceOpeningFacePairs ?? calibration.openingFacePairs ?? [],
    },
  })
  const matches = pairs.filter(
    (pair) =>
      pair.bindings.some(({ opening }) => opening.id === survey.openingId) &&
      pair.bindings.some(({ wall }) => wall.id === survey.outerWallId),
  )
  const pair = matches[0]
  if (matches.length !== 1 || !pair) return undefined
  const outer = pair.bindings.find(({ wall }) => wall.id === survey.outerWallId)
  const sameCut = (first: [PlanPoint, PlanPoint], second: [PlanPoint, PlanPoint]) =>
    [second, [second[1], second[0]]].some((candidate) =>
      first.every(
        (point, index) =>
          point.xCm === candidate[index]?.xCm && point.yCm === candidate[index]?.yCm,
      ),
    )
  if (
    !outer?.cut ||
    !sameCut(outer.cut, survey.outerCut) ||
    !pair.bindings.every(({ opening, cut }) => {
      const current = planOpeningEndpoints(geometry, opening.id)
      return cut && current && sameCut(cut, current)
    })
  )
    return undefined
  return {
    pair,
    geometryKey: survey.geometryKey,
    referenceKey: survey.referenceKey,
    outerOpeningId: outer.opening.id,
    outerBottomElevationCm: survey.outerBottomElevationCm,
    outerTopElevationCm: survey.outerTopElevationCm,
    thresholdElevationCm: survey.thresholdElevationCm,
  }
}
const bodyPolygon = (points: PlanPoint[]): Polygon => [points.map(({ xCm, yCm }) => [xCm, yCm])]
function envelope(point: PlanPoint, body: Body): [number, number, number, number] {
  const horizontal = enclosingTurnBounds(point, body.widthCm, 0, body.widthCm)
  const vertical = enclosingTurnBounds(point, body.depthCm, 0, body.depthCm)
  if (!horizontal || !vertical) throw new Error('Не удалось оградить полный габарит заноса.')
  return [horizontal[0], vertical[1], horizontal[2], vertical[3]]
}
const rect = ([left, top, right, bottom]: readonly number[]): Polygon => [
  [
    [left as number, top as number],
    [right as number, top as number],
    [right as number, bottom as number],
    [left as number, bottom as number],
  ],
]

/** Measured exterior landing and protected source aperture. No apartment slab is extended. */
export function inspectFurnitureExteriorIngress(
  geometry: PlanGeometry,
  input: unknown,
  body: Body,
  inside: Position,
  leaves: readonly FurnitureDoorLeafVolume[],
  maxNodes: number,
): {
  error?: string
  points?: Position[]
  checkedNodes?: number
  wallSolids?: Polygon[]
} {
  const fail = (error: string) => ({ error })
  try {
    const parsed = furnitureExteriorIngressSchema.safeParse(input)
    if (!parsed.success)
      return fail(
        'Нужны полные обмеры наружной площадки, двух граней дверного блока и подтверждение.',
      )
    const survey = parsed.data
    const signed = signedPlanFloors(geometry)
    if (
      !signed?.ok ||
      survey.geometryKey !== JSON.stringify(geometry) ||
      survey.referenceKey !== verticalReferenceReviewKey(signed.reference)
    )
      return fail('Наружные обмеры не относятся к текущему плану и общему нулю.')
    if (
      survey.openingId !== geometry.routeStartOpeningId ||
      !leaves.some((leaf) => leaf.openingIds.includes(survey.openingId))
    )
      return fail('Для наружного заноса нужны выбранная стартовая дверь и её обмеренная створка.')
    if (
      ![body.widthCm, body.depthCm, body.heightCm].every(
        (value) => Number.isFinite(value) && value > 0,
      ) ||
      maxNodes < 3 ||
      maxNodes > 6000 ||
      !Number.isInteger(maxNodes)
    )
      return fail('Недостаточен бюджет либо неизвестен переносимый габарит.')
    const opening = geometry.openings.find((value) => value.id === survey.openingId)
    const innerWall = geometry.walls.find((value) => value.id === opening?.wallId)
    const outerWall = geometry.walls.find((value) => value.id === survey.outerWallId)
    const innerCut = planOpeningEndpoints(geometry, survey.openingId)
    const proof = currentOpeningWidthProofs(geometry).find(
      (value) => value.opening.id === survey.openingId,
    )
    const base = signed.reference.wallBases.find((value) => value.wall.id === innerWall?.id)
    const floor = signed.reference.floors.find((value) => value.id === base?.floorId)
    const ceiling = signed.reference.ceilings?.find((value) => value.floorId === floor?.id)
    if (
      !opening ||
      opening.type === 'window' ||
      !innerWall ||
      innerWall.kind !== 'outer' ||
      !outerWall ||
      outerWall.id === innerWall.id ||
      !innerCut ||
      !proof ||
      floor?.surface !== 'finished-floor' ||
      !ceiling ||
      inside.zCm !== floor.elevationCm ||
      opening.bottomCm === undefined ||
      opening.heightCm === undefined
    )
      return fail('Не подтверждены наружная дверь, её исходные грани и внутренний чистовой пол.')
    const outer = survey.outerCut
    if (!exactSegmentContains(outerWall.start, outerWall.end, outer))
      return fail('Наружный срез не принадлежит измеренной второй грани дверного блока.')
    const [a, b, c, d] = integerPoints([...innerCut, ...outer])
    if (!a || !b || !c || !d) return fail('Не подтверждены концы дверного блока.')
    const along = vector(a, b),
      opposite = vector(c, d)
    const forward = dot(along, opposite) > 0n
    const [outerStart, outerEnd] = forward ? outer : [outer[1], outer[0]]
    const ordered = integerPoints([...innerCut, outerStart, outerEnd])
    const [first, last, third, fourth] = ordered
    if (
      !first ||
      !last ||
      !third ||
      !fourth ||
      cross(along, opposite) !== 0n ||
      dot(along, along) !== dot(opposite, opposite) ||
      dot(vector(first, third), along) !== 0n ||
      dot(vector(last, fourth), along) !== 0n ||
      cross(along, vector(first, third)) === 0n
    )
      return fail('Нужны две параллельные грани одинаковой ширины и точно связанные косяки.')
    const gate = bodyPolygon([innerCut[0], innerCut[1], outerEnd, outerStart])
    const outside = bodyPolygon(survey.outside.polygon)
    if (
      !simpleSurveyRing(survey.outside.polygon) ||
      polygonClipping.intersection(outside, bodyPolygon(geometry.footprint ?? [])).length
    )
      return fail('Наружная площадка должна быть простым измеренным контуром снаружи квартиры.')
    const boundaryOwns = (polygon: PlanPoint[], cut: PlanPoint[]) =>
      polygon.some((point, index) => {
        const next = polygon[(index + 1) % polygon.length]
        return next && exactSegmentContains(point, next, cut)
      })
    if (
      !boundaryOwns(survey.outside.polygon, [outerStart, outerEnd]) ||
      !boundaryOwns(floor.room.polygon, innerCut)
    )
      return fail('Площадка и внутренний пол не соединены с реальными срезами двери.')
    if (
      polygonClipping.intersection(gate, outside).length ||
      signed.surfaces.some(
        (surface) => polygonClipping.intersection(gate, bodyPolygon(surface.floor)).length,
      )
    )
      return fail('Дверной коридор перекрывает полы вместо пространства между гранями.')
    if (
      survey.thresholdElevationCm < Math.max(survey.outside.elevationCm, floor.elevationCm) ||
      survey.carryElevationCm < survey.thresholdElevationCm ||
      survey.carryElevationCm < survey.outerBottomElevationCm ||
      compareDecimalSums([survey.carryElevationCm, body.heightCm], [survey.outerTopElevationCm]) >
        0 ||
      compareDecimalSums(
        [survey.carryElevationCm, body.heightCm],
        [survey.corridorCeilingElevationCm],
      ) > 0 ||
      compareDecimalSums([survey.carryElevationCm], [floor.elevationCm, opening.bottomCm]) < 0 ||
      compareDecimalSums(
        [survey.carryElevationCm, body.heightCm],
        [floor.elevationCm, opening.bottomCm, opening.heightCm],
      ) > 0 ||
      compareDecimalSums(
        [survey.carryElevationCm, body.heightCm],
        [survey.outside.ceilingElevationCm],
      ) > 0 ||
      compareDecimalSums([survey.carryElevationCm, body.heightCm], [ceiling.elevationCm]) > 0
    )
      return fail(
        'Подъём, порог или верх всего габарита не помещаются в измеренный просвет заноса.',
      )
    const model = inspectTransferWallSolids(
      geometry,
      furnitureExteriorOpeningWitness(geometry, input),
    )
    if (model.error) return fail(model.error)
    const pairs = currentWallFacePairs(geometry)
    const eligible = pairs.filter(
      (pair) =>
        pair.faces.every((face) => [innerWall.id, outerWall.id].includes(face.wall.id)) &&
        new Set(pair.faces.map((face) => face.wall.id)).size === 2,
    )
    const samePolygon = (first: Polygon, second: Polygon) =>
      polygonClipping.difference(first, second).length === 0 &&
      polygonClipping.difference(second, first).length === 0
    const entryGates = model.openings.filter(
      (value) =>
        value.openingIds.includes(opening.id) &&
        value.openingIds.some((id) =>
          geometry.openings.some((other) => other.id === id && other.wallId === outerWall.id),
        ) &&
        samePolygon(value.polygon, gate),
    )
    if (entryGates.length > 1 || (!eligible.length && entryGates.length !== 1))
      return fail('Не подтверждена однозначная физическая полоса стены или косяков двери.')
    const stripPolygon = (pair: (typeof pairs)[number]) => {
      const [first, second] = pair.faces
      const [a, b, c, d] = integerPoints([first.start, first.end, second.start, second.end])
      if (!a || !b || !c || !d) throw new Error('Не подтверждены грани стены.')
      const forward = dot(vector(a, b), vector(c, d)) > 0n
      return bodyPolygon([
        first.start,
        first.end,
        forward ? second.end : second.start,
        forward ? second.start : second.end,
      ])
    }
    if (
      pairs.some(
        (pair) =>
          !eligible.includes(pair) && polygonClipping.intersection(gate, stripPolygon(pair)).length,
      )
    )
      return fail('Коридор двери пересекает другую подтверждённую полосу стены.')
    const removable = eligible.map(stripPolygon)
    const coverage = [...removable, ...entryGates.map((value) => value.polygon)]
    if (
      polygonClipping.difference(
        gate,
        polygonClipping.union(coverage[0] as Polygon, ...coverage.slice(1)),
      ).length
    )
      return fail('Коридор двери не покрыт подтверждённой физической толщиной стены.')
    const solids: Polygon[] = model.solids.flatMap((solid) => {
      const eligibleSolid = removable.some((strip) => samePolygon(solid, strip))
      return eligibleSolid ? polygonClipping.difference(solid, gate) : [solid]
    })
    // The exterior search may use the inside landing too. Other physical openings
    // must not become free slots merely because they were omitted from wall solids.
    solids.push(
      ...model.openings
        .filter(
          (opening) =>
            opening.bottomTerms.length !== 2 ||
            opening.topTerms.length !== 2 ||
            (!entryGates.includes(opening) && opening.thresholdElevationCm === undefined) ||
            (opening.thresholdElevationCm !== undefined &&
              survey.thresholdElevationCm < opening.thresholdElevationCm &&
              entryGates.includes(opening)) ||
            (opening.thresholdElevationCm !== undefined &&
              survey.carryElevationCm < opening.thresholdElevationCm) ||
            opening.bottomTerms.some(
              (terms) => compareDecimalSums([survey.carryElevationCm], terms) < 0,
            ) ||
            opening.topTerms.some(
              (terms) => compareDecimalSums([survey.carryElevationCm, body.heightCm], terms) > 0,
            ),
        )
        .map((opening) => opening.polygon),
    )
    const indoor = signed.surfaces
      .filter((surface) => surface.floorId === floor.id)
      .map(
        (surface): Polygon => [
          surface.floor.map(({ xCm, yCm }) => [xCm, yCm]),
          ...surface.voids.map((hole) =>
            hole.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
          ),
        ],
      )
    if (!indoor[0]) return fail('Не найден физический внутренний пол заноса.')
    const insideFloor = polygonClipping.union(indoor[0], ...indoor.slice(1))
    const startBounds = envelope(survey.outside.start, body),
      insideBounds = envelope(inside, body)
    if (
      polygonClipping.difference(rect(startBounds), outside).length ||
      polygonClipping.difference(rect(insideBounds), insideFloor).length
    )
      return fail(
        'Весь габарит начала и окончания заноса должен помещаться на измеренных площадках.',
      )
    const freeFloor = polygonClipping.difference(
      polygonClipping.union(outside, gate, ...indoor),
      ...solids,
    )
    const blocked = (bounds: [number, number, number, number]) =>
      doorLeafBlocks(
        leaves,
        bounds,
        survey.carryElevationCm,
        enclosingDecimalSum([survey.carryElevationCm, body.heightCm]),
      )
    if (
      doorLeafBlocks(
        leaves,
        startBounds,
        survey.outside.elevationCm,
        enclosingDecimalSum([survey.carryElevationCm, body.heightCm]),
      ) ||
      doorLeafBlocks(
        leaves,
        insideBounds,
        floor.elevationCm,
        enclosingDecimalSum([survey.carryElevationCm, body.heightCm]),
      )
    )
      return fail('Подъём или опускание полного габарита пересекает створку.')
    const route = inspectSourceClearanceRoutes({
      freeFloor,
      rooms: [{ id: 'inside', polygon: floor.room.polygon }],
      start: survey.outside.start,
      widthCm: body.widthCm,
      footprintCm: { widthCm: body.widthCm, depthCm: body.depthCm },
      goal: { roomId: 'inside', point: inside },
      blockedVolume: blocked,
      maxNodes: maxNodes - 2,
      metricObstacles: {
        voids: geometry.voids,
        obstacles: [
          ...(geometry.obstacles ?? []),
          ...(geometry.kitchenItems ?? []).map((item) => ({ ...item, kind: 'fixed' as const })),
        ],
      },
    })
    const path = route.routes[0]?.points
    if (!path) return fail('Не построен непрерывный наружный занос через измеренную дверь.')
    const points: Position[] = [
      { ...survey.outside.start, zCm: survey.outside.elevationCm },
      ...path.map((point) => ({ ...point, zCm: survey.carryElevationCm })),
      { ...inside, zCm: floor.elevationCm },
    ]
    return { points, checkedNodes: route.checkedNodes + 2, wallSolids: solids }
  } catch {
    return fail('Не удалось подтвердить полный объём наружного заноса по введённым обмерам.')
  }
}
