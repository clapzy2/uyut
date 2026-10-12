import type { PlanGeometry, PlanOpening } from '@uyut/db'
import { z } from 'zod'
import { currentOpeningFacePairs, currentOpeningWidthProofs } from './plan-opening-face-pairs'
import {
  currentPlanVerticalReference,
  inspectPlanVerticalReference,
  openingOnVerticalFloorBoundary,
} from './plan-vertical-reference'
import type { PlanGeometryIssue } from './plan-volume-types'

type VerticalGeometry = Pick<PlanGeometry, 'walls' | 'openings'> &
  Partial<
    Pick<
      PlanGeometry,
      'rooms' | 'pdfCalibration' | 'verticalReference' | 'imageCalibration' | 'footprint' | 'voids'
    >
  >

/** Compare entered decimal values without rounding a small physical difference away. */
function compareElevations(first: [number, number], second: [number, number]): number | null {
  if ([...first, ...second].some((value) => !Number.isFinite(value))) return null
  const values = [...first, ...second].map((value) => {
    const [mantissa = '', exponent = '0'] = value.toString().split('e')
    const [whole = '', fraction = ''] = mantissa.split('.')
    const places = fraction.length - Number(exponent)
    return {
      integer: BigInt(whole + fraction) * (places < 0 ? 10n ** BigInt(-places) : 1n),
      places: Math.max(0, places),
    }
  })
  const precision = Math.max(...values.map(({ places }) => places))
  const scaled = values.map(({ integer, places }) => integer * 10n ** BigInt(precision - places))
  const difference =
    (scaled[0] as bigint) + (scaled[1] as bigint) - (scaled[2] as bigint) - (scaled[3] as bigint)
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

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
  const referenceGeometry = { ...geometry, rooms: geometry.rooms ?? [] }
  const referenceIssues = inspectPlanVerticalReference(referenceGeometry)
  if (referenceIssues.length) return referenceIssues
  const reference = currentPlanVerticalReference(referenceGeometry)
  const floors = new Map(reference?.floors.map((floor) => [floor.id, floor]))
  const wallFloors = new Map(
    reference?.wallBases.map(({ wall, floorId }) => [wall.id, floors.get(floorId)]),
  )
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
    // Compare the entered decimal measurements without inventing an allowance
    // above the wall or a binary-floating overrun at an exact boundary.
    const top: [number, number] | undefined =
      bottom !== undefined &&
      openingHeight !== undefined &&
      Number.isFinite(bottom) &&
      bottom >= 0 &&
      bottom <= 600 &&
      Number.isFinite(openingHeight) &&
      openingHeight > 0 &&
      openingHeight <= 600
        ? [bottom, openingHeight]
        : undefined
    if (
      !height.safeParse(openingHeight).success ||
      (bottom !== undefined && (!Number.isFinite(bottom) || bottom < 0 || bottom > 600)) ||
      (top !== undefined && compareElevations(top, [600, 0]) === 1) ||
      (wallHeight !== undefined &&
        ((bottom !== undefined && bottom >= wallHeight) ||
          (openingHeight !== undefined && openingHeight > wallHeight) ||
          (top !== undefined && compareElevations(top, [wallHeight, 0]) === 1)))
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
      const firstFloor = wallFloors.get(first.wallId)
      const secondFloor = wallFloors.get(second.wallId)
      const unresolvedBottomReference =
        reference &&
        first.bottomCm !== undefined &&
        second.bottomCm !== undefined &&
        (firstFloor?.surface !== 'finished-floor' || secondFloor?.surface !== 'finished-floor')
      if (unresolvedBottomReference) {
        issues.push({
          id: `opening-paired-floor-reference-${ids.join('-')}`,
          severity: 'error',
          message:
            'Нижняя грань проёма измерена от чистого пола. Для сравнения сторон нужны отметки чистого пола; уровень существующего пола их не заменяет.',
          openingIds: ids,
        })
        continue
      }
      if (
        reference &&
        first.bottomCm !== undefined &&
        second.bottomCm !== undefined &&
        (!firstFloor ||
          !secondFloor ||
          !openingOnVerticalFloorBoundary(referenceGeometry, first.id, firstFloor.id) ||
          !openingOnVerticalFloorBoundary(referenceGeometry, second.id, secondFloor.id))
      ) {
        issues.push({
          id: `opening-paired-floor-owner-${ids.join('-')}`,
          severity: 'error',
          message:
            'Стороны проёма не привязаны однозначно к границам назначенных полов. Сверьте хозяев отметок перед сравнением нижних граней.',
          openingIds: ids,
        })
        continue
      }
      const conflictingBottom =
        first.bottomCm !== undefined &&
        second.bottomCm !== undefined &&
        (reference && firstFloor !== undefined && secondFloor !== undefined
          ? compareElevations(
              [firstFloor.elevationCm, first.bottomCm],
              [secondFloor.elevationCm, second.bottomCm],
            ) !== 0
          : first.bottomCm !== second.bottomCm)
      if (conflictingHeight || conflictingBottom) {
        issues.push({
          id: `opening-paired-height-${ids.join('-')}`,
          severity: 'error',
          message: conflictingBottom
            ? reference
              ? 'Нижние грани двух сторон одного проёма не совпадают в общем высотном отсчёте. Сверьте отметки полов и локальные мерки проёма.'
              : 'Нижние грани двух сторон одного проёма различаются. Уточните уровни пола и общий высотный отсчёт: текущая плоская модель не переносит этот перепад в 2D/3D.'
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
