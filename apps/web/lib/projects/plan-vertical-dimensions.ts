import type { PlanGeometry, PlanOpening } from '@uyut/db'
import { z } from 'zod'
import type { PlanGeometryIssue } from './plan-geometry-inspection'
import { currentOpeningFacePairs, currentOpeningWidthProofs } from './plan-opening-face-pairs'

type VerticalGeometry = Pick<PlanGeometry, 'walls' | 'openings'> &
  Partial<Pick<PlanGeometry, 'rooms' | 'pdfCalibration'>>

const height = z.number().finite().positive().max(600).optional()
const thickness = z.number().finite().min(1).max(100).optional()
const dimensionId = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value === value.trim())
const verticalDimensionsSchema = z.object({
  walls: z
    .array(z.object({ id: dimensionId, heightCm: height, measuredThicknessCm: thickness }))
    .max(200),
  openings: z
    .array(
      z.object({
        id: dimensionId,
        heightCm: height,
        bottomCm: z.number().finite().min(0).max(600).optional(),
      }),
    )
    .max(200),
})

export function openingFloorLevel(opening: Pick<PlanOpening, 'bottomCm'>) {
  if (opening.bottomCm === undefined) return 'unknown' as const
  if (!Number.isFinite(opening.bottomCm) || opening.bottomCm < 0 || opening.bottomCm > 600)
    return 'invalid' as const
  return opening.bottomCm === 0 ? ('at-floor' as const) : ('raised' as const)
}

/** Completeness of explicit model values, not acceptance of a source height or a physical passage. */
export function planVerticalMeasurementReport(geometry: VerticalGeometry) {
  const missingWallHeightIds = geometry.walls
    .filter((wall) => wall.heightCm === undefined)
    .map(({ id }) => id)
  const missingWallThicknessIds = geometry.walls
    .filter((wall) => wall.measuredThicknessCm === undefined)
    .map(({ id }) => id)
  const missingOpeningHeightIds = geometry.openings
    .filter((opening) => opening.heightCm === undefined)
    .map(({ id }) => id)
  const missingOpeningBottomIds = geometry.openings
    .filter((opening) => opening.bottomCm === undefined)
    .map(({ id }) => id)
  const floorOpenings = geometry.openings.filter((opening) => opening.type !== 'window')
  return {
    surfaceStatus: inspectPlanVerticalDimensions(geometry).length
      ? ('invalid' as const)
      : missingWallHeightIds.length ||
          missingOpeningHeightIds.length ||
          missingOpeningBottomIds.length
        ? ('partial' as const)
        : ('complete' as const),
    missingWallHeightIds,
    missingWallThicknessIds,
    missingOpeningHeightIds,
    missingOpeningBottomIds,
    raisedThresholdIds: floorOpenings
      .filter((opening) => openingFloorLevel(opening) === 'raised')
      .map(({ id }) => id),
    unknownThresholdIds: floorOpenings
      .filter((opening) => openingFloorLevel(opening) === 'unknown')
      .map(({ id }) => id),
  }
}
export type PlanVerticalMeasurementReport = ReturnType<typeof planVerticalMeasurementReport>

export function inspectPlanVerticalDimensions(geometry: VerticalGeometry): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = []
  if (
    geometry.walls.some(({ id }) => !dimensionId.safeParse(id).success) ||
    geometry.openings.some(
      ({ id, wallId }) =>
        !dimensionId.safeParse(id).success || !dimensionId.safeParse(wallId).success,
    )
  )
    return [
      {
        id: 'vertical-element-identity',
        severity: 'error',
        message:
          'Для сверки высот нужны непустые идентификаторы стен и проёмов без лишних пробелов.',
      },
    ]
  const wallIds = new Set(geometry.walls.map(({ id }) => id))
  if (
    wallIds.size !== geometry.walls.length ||
    new Set(geometry.openings.map(({ id }) => id)).size !== geometry.openings.length
  )
    return [
      {
        id: 'vertical-element-identity',
        severity: 'error',
        message: 'Стены и проёмы должны иметь уникальные идентификаторы для сверки высот.',
      },
    ]
  for (const wall of geometry.walls) {
    if (!thickness.safeParse(wall.measuredThicknessCm).success) {
      issues.push({
        id: `wall-thickness-${wall.id}`,
        severity: 'error',
        message: 'Толщина стены по обмеру должна быть от 1 до 100 см.',
        wallIds: [wall.id],
      })
    }
    if (!height.safeParse(wall.heightCm).success) {
      issues.push({
        id: `wall-height-${wall.id}`,
        severity: 'error',
        message: 'Высота стены должна быть больше 0 и не больше 600 см.',
        wallIds: [wall.id],
      })
    }
  }
  for (const opening of geometry.openings) {
    if (!wallIds.has(opening.wallId)) {
      issues.push({
        id: `opening-height-host-${opening.id}`,
        severity: 'error',
        message: 'Проём по высоте должен быть привязан к существующей стене.',
        openingIds: [opening.id],
      })
      continue
    }
    const bottom = opening.bottomCm
    const openingHeight = opening.heightCm
    const wallHeight = geometry.walls.find((wall) => wall.id === opening.wallId)?.heightCm
    if (
      !height.safeParse(openingHeight).success ||
      (bottom !== undefined && (!Number.isFinite(bottom) || bottom < 0 || bottom > 600)) ||
      (bottom !== undefined && openingHeight !== undefined && bottom + openingHeight > 600) ||
      (wallHeight !== undefined &&
        ((bottom !== undefined && bottom >= wallHeight) ||
          (openingHeight !== undefined && openingHeight > wallHeight) ||
          (bottom !== undefined &&
            openingHeight !== undefined &&
            bottom + openingHeight > wallHeight + 1e-7)))
    ) {
      issues.push({
        id: `opening-height-${opening.id}`,
        severity: 'error',
        message: 'Проверьте высоту и нижнюю грань проёма: они должны помещаться по высоте стены.',
        openingIds: [opening.id],
      })
    }
  }
  if (geometry.rooms && geometry.pdfCalibration) {
    const currentGeometry = { ...geometry, rooms: geometry.rooms }
    const pairedIds = currentOpeningFacePairs(currentGeometry).map(({ bindings: [a, b] }) => [
      a.opening.id,
      b.opening.id,
    ])
    for (const proof of currentOpeningWidthProofs(currentGeometry)) {
      if (
        proof.sameOpeningAs &&
        proof.oppositeBinding &&
        proof.sameOpeningAs.openingId === proof.oppositeBinding.opening.id
      )
        pairedIds.push([proof.opening.id, proof.oppositeBinding.opening.id])
    }
    const seenPairs = new Set<string>()
    for (const ids of pairedIds) {
      ids.sort()
      const key = JSON.stringify(ids)
      if (ids[0] === ids[1] || seenPairs.has(key)) continue
      seenPairs.add(key)
      const first = geometry.openings.find(({ id }) => id === ids[0])
      const second = geometry.openings.find(({ id }) => id === ids[1])
      if (!first || !second) continue
      // These are current source-bound copies of one aperture, not nearby openings.
      // Missing values stay unknown; no side supplies the other side's measurements.
      const conflictingHeight =
        first.heightCm !== undefined &&
        second.heightCm !== undefined &&
        first.heightCm !== second.heightCm
      const conflictingBottom =
        first.bottomCm !== undefined &&
        second.bottomCm !== undefined &&
        first.bottomCm !== second.bottomCm
      if (conflictingHeight || conflictingBottom) {
        issues.push({
          id: `opening-paired-height-${ids.join('-')}`,
          severity: 'error',
          message: conflictingBottom
            ? 'Нижние грани двух сторон одного проёма различаются. Уточните уровни пола и общий высотный отсчёт: текущая плоская модель не переносит этот перепад в 2D/3D.'
            : 'У двух сторон одного проёма различаются высоты. Сверьте мерки до переноса в 2D/3D.',
          openingIds: ids,
        })
      }
    }
  }
  return issues
}

/** Only explicit browser measurements enter the model; vision output has no such path. */
export function applyPlanVerticalDimensions(
  geometry: PlanGeometry,
  input: unknown,
): { ok: true; geometry: PlanGeometry } | { ok: false; error: string } {
  const parsed = verticalDimensionsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Проверьте мерки: высоты до 600 см, толщина стены от 1 до 100 см.',
    }
  }
  const matchingInventory = (expected: { id: string }[], submitted: { id: string }[]) =>
    new Set(expected.map(({ id }) => id)).size === expected.length &&
    submitted.length === expected.length &&
    new Set(submitted.map(({ id }) => id)).size === submitted.length &&
    submitted.every(({ id }) => expected.some((element) => element.id === id))
  if (
    !matchingInventory(geometry.walls, parsed.data.walls) ||
    !matchingInventory(geometry.openings, parsed.data.openings)
  )
    return {
      ok: false,
      error: 'Список стен или проёмов изменился. Откройте актуальную схему и повторите ввод мерок.',
    }
  const wallDimensions = new Map(parsed.data.walls.map((wall) => [wall.id, wall]))
  const openingDimensions = new Map(parsed.data.openings.map((opening) => [opening.id, opening]))
  const result: PlanGeometry = {
    ...geometry,
    walls: geometry.walls.map((wall) => {
      const {
        heightCm: _previousHeight,
        measuredThicknessCm: _previousThickness,
        ...horizontal
      } = wall
      const dimensions = wallDimensions.get(wall.id)
      return {
        ...horizontal,
        ...(dimensions?.heightCm === undefined ? {} : { heightCm: dimensions.heightCm }),
        ...(dimensions?.measuredThicknessCm === undefined
          ? {}
          : { measuredThicknessCm: dimensions.measuredThicknessCm }),
      }
    }),
    openings: geometry.openings.map((opening) => {
      const { bottomCm: _previousBottom, heightCm: _previousHeight, ...horizontal } = opening
      const dimensions = openingDimensions.get(opening.id)
      return {
        ...horizontal,
        ...(dimensions?.bottomCm === undefined ? {} : { bottomCm: dimensions.bottomCm }),
        ...(dimensions?.heightCm === undefined ? {} : { heightCm: dimensions.heightCm }),
      }
    }),
  }
  const issue = inspectPlanVerticalDimensions(result)[0]
  return issue ? { ok: false, error: issue.message } : { ok: true, geometry: result }
}
