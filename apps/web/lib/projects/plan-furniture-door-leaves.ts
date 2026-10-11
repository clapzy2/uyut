import {
  compareDecimalSums,
  cross,
  dot,
  integerPoints,
  vector,
} from '@uyut/catalog/plan-exact-geometry'
import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
} from '@uyut/catalog/plan-opening-face-pairs'
import {
  signedPlanFloors,
  verticalReferenceReviewKey,
} from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanOpeningBinding, PlanPoint } from '@uyut/db'
import type { Polygon } from 'polygon-clipping'
import { z } from 'zod'
import { doorLeafBounds } from './plan-tilt-angle-envelope'
import { inspectPlanVerticalDimensions } from './plan-vertical-dimensions'

const coordinate = z.number().finite().min(-10000).max(10000)
const point = z.object({ xCm: coordinate, yCm: coordinate }).strict()
const elevation = z.number().finite().min(-600).max(1200)

/** Measured single leaves only; source cut endpoints do not imply a measured open pose. */
export const furnitureDoorLeafSurveySchema = z
  .object({
    geometryKey: z.string().min(1).max(1000000),
    referenceKey: z.string().min(1).max(1000000),
    source: z
      .object({
        kind: z.enum(['site-measurement', 'dimensioned-drawing']),
        reference: z.string().trim().min(1).max(1000),
      })
      .strict(),
    acknowledged: z.literal(true),
    leaves: z
      .array(
        z
          .object({
            openingId: z.string().trim().min(1).max(100),
            hinge: point,
            closedTip: point,
            thicknessCm: z.number().finite().min(0.1).max(20),
            bottomElevationCm: elevation,
            topElevationCm: elevation,
            openAngleDeg: z.number().finite().min(-180).max(180),
            mode: z.enum(['fixed-open', 'moving']),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()

export type FurnitureDoorLeafSurvey = z.infer<typeof furnitureDoorLeafSurveySchema>
export type FurnitureDoorLeafVolume = {
  openingId: string
  openingIds: string[]
  polygon: Polygon
  bounds: [number, number, number, number]
  bottomElevationCm: number
  topElevationCm: number
  mode: 'fixed-open' | 'moving'
}

const samePoint = (a: PlanPoint, b: PlanPoint) => a.xCm === b.xCm && a.yCm === b.yCm

function validCut(cut: PlanOpeningBinding['cut']): cut is [PlanPoint, PlanPoint] {
  return (
    Array.isArray(cut) &&
    cut.length === 2 &&
    cut.every((point) => point && Number.isFinite(point.xCm) && Number.isFinite(point.yCm)) &&
    !samePoint(cut[0], cut[1])
  )
}

function sameCut(first: PlanOpeningBinding['cut'], second: PlanOpeningBinding['cut']) {
  return (
    validCut(first) &&
    validCut(second) &&
    ((samePoint(first[0], second[0]) && samePoint(first[1], second[1])) ||
      (samePoint(first[1], second[0]) && samePoint(first[0], second[1])))
  )
}

function measuredClosedDirection(hinge: PlanPoint, tip: PlanPoint, cut: PlanOpeningBinding['cut']) {
  if (!validCut(cut)) return false
  const opposite = samePoint(hinge, cut[0]) ? cut[1] : samePoint(hinge, cut[1]) ? cut[0] : undefined
  if (!opposite) return false
  const [origin, end, jamb] = integerPoints([hinge, tip, opposite])
  if (!origin || !end || !jamb) return false
  const leaf = vector(origin, end)
  const opening = vector(origin, jamb)
  return cross(leaf, opening) === 0n && dot(leaf, opening) > 0n
}

/** Invalid, stale, incomplete, or multi-leaf surveys hold the entire check. */
export function inspectFurnitureDoorLeaves(
  geometry: PlanGeometry,
  input: unknown,
): { error?: string; volumes: FurnitureDoorLeafVolume[] } {
  const fail = (error: string) => ({ error, volumes: [] })
  const parsed = furnitureDoorLeafSurveySchema.safeParse(input)
  if (!parsed.success)
    return fail('Нужны явные обмеры каждой створки, положения открытия и подтверждение сверки.')
  const survey = parsed.data
  const signed = signedPlanFloors(geometry)
  if (
    !signed?.ok ||
    survey.geometryKey !== JSON.stringify(geometry) ||
    survey.referenceKey !== verticalReferenceReviewKey(signed.reference) ||
    inspectPlanVerticalDimensions(geometry).length
  )
    return fail(
      'Обмеры створок должны относиться к текущим граням, проёмам и общему отсчёту высот.',
    )

  const pairs = currentOpeningFacePairs(geometry)
  const proofs = currentOpeningWidthProofs(geometry)
  const covered = new Set<string>()
  const volumes: FurnitureDoorLeafVolume[] = []
  for (const leaf of survey.leaves) {
    const opening = geometry.openings.find(({ id }) => id === leaf.openingId)
    if (!opening || opening.type === 'window') return fail('Створка не связана с дверным проёмом.')
    const matches = pairs.filter(({ bindings }) =>
      bindings.some(({ opening }) => opening.id === leaf.openingId),
    )
    const pair = matches[0]
    const proof = proofs.find(
      ({ opening, oppositeBinding }) =>
        opening.id === leaf.openingId || oppositeBinding?.opening.id === leaf.openingId,
    )
    const bindings: PlanOpeningBinding[] = pair
      ? pair.bindings
      : proof
        ? [proof, ...(proof.oppositeBinding ? [proof.oppositeBinding] : [])]
        : []
    const binding = bindings.find(({ opening }) => opening.id === leaf.openingId)
    const candidates = [
      ...pairs.flatMap(({ bindings }) => bindings),
      ...proofs.flatMap((proof) => [
        proof,
        ...(proof.oppositeBinding ? [proof.oppositeBinding] : []),
      ]),
    ].filter(({ opening }) => opening.id === leaf.openingId)
    if (
      !binding ||
      !validCut(binding.cut) ||
      matches.length > 1 ||
      candidates.some(({ cut }) => !sameCut(cut, binding.cut)) ||
      !measuredClosedDirection(leaf.hinge, leaf.closedTip, binding.cut) ||
      samePoint(leaf.hinge, leaf.closedTip) ||
      bindings.some(({ opening }) => covered.has(opening.id))
    )
      return fail(
        'Нужна одна цельная створка на текущем исходном срезе; две створки не подменяются одной.',
      )

    for (const { opening: snapshot } of bindings) {
      const current = geometry.openings.find(({ id }) => id === snapshot.id)
      const base = signed.reference.wallBases.find(({ wall }) => wall.id === snapshot.wallId)
      const floor = signed.reference.floors.find(({ id }) => id === base?.floorId)
      if (
        !current ||
        current.type === 'window' ||
        !floor ||
        current.bottomCm === undefined ||
        current.heightCm === undefined ||
        compareDecimalSums([leaf.topElevationCm], [leaf.bottomElevationCm]) <= 0 ||
        compareDecimalSums([leaf.bottomElevationCm], [floor.elevationCm, current.bottomCm]) < 0 ||
        compareDecimalSums(
          [leaf.topElevationCm],
          [floor.elevationCm, current.bottomCm, current.heightCm],
        ) > 0
      )
        return fail(
          'Высоты створки должны помещаться в измеренные нижнюю и верхнюю границы проёма.',
        )
    }
    const bounds = doorLeafBounds(
      leaf.hinge,
      leaf.closedTip,
      leaf.thicknessCm,
      leaf.openAngleDeg,
      leaf.mode,
    )
    if (!bounds) return fail('Не удалось подтвердить численное ограждение створки.')
    const [left, top, right, bottom] = bounds
    const openingIds = bindings.map(({ opening }) => opening.id)
    for (const id of openingIds) covered.add(id)
    volumes.push({
      openingId: leaf.openingId,
      openingIds,
      bounds,
      polygon: [
        [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ],
      ],
      bottomElevationCm: leaf.bottomElevationCm,
      topElevationCm: leaf.topElevationCm,
      mode: leaf.mode,
    })
  }
  if (geometry.openings.some(({ id, type }) => type !== 'window' && !covered.has(id)))
    return fail(
      'Положение хотя бы одной дверной створки неизвестно: неполная проверка не разрешена.',
    )
  return { volumes }
}

/** Closed interval contact blocks, including the entire carried translation or turn envelope. */
export function doorLeafBlocks(
  volumes: readonly FurnitureDoorLeafVolume[],
  bounds: readonly [number, number, number, number],
  bottomElevationCm: number,
  topElevationCm: number,
): boolean {
  if (
    ![...bounds, bottomElevationCm, topElevationCm].every(Number.isFinite) ||
    bounds[0] > bounds[2] ||
    bounds[1] > bounds[3] ||
    bottomElevationCm > topElevationCm
  )
    return true
  return volumes.some(
    (leaf) =>
      topElevationCm >= leaf.bottomElevationCm &&
      bottomElevationCm <= leaf.topElevationCm &&
      bounds[2] >= leaf.bounds[0] &&
      bounds[0] <= leaf.bounds[2] &&
      bounds[3] >= leaf.bounds[1] &&
      bounds[1] <= leaf.bounds[3],
  )
}
