import type { PlanGeometry } from '@uyut/db'
import { z } from 'zod'
import type { PlanGeometryIssue } from './plan-geometry-inspection'

const height = z.number().finite().positive().max(600).optional()
const thickness = z.number().finite().min(1).max(100).optional()
const verticalDimensionsSchema = z.object({
  walls: z
    .array(z.object({ id: z.string(), heightCm: height, measuredThicknessCm: thickness }))
    .max(200),
  openings: z
    .array(
      z.object({
        id: z.string(),
        heightCm: height,
        bottomCm: z.number().finite().min(0).max(600).optional(),
      }),
    )
    .max(200),
})

export function inspectPlanVerticalDimensions(
  geometry: Pick<PlanGeometry, 'walls' | 'openings'>,
): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = []
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
    const bottom = opening.bottomCm
    const openingHeight = opening.heightCm
    const wallHeight = geometry.walls.find((wall) => wall.id === opening.wallId)?.heightCm
    if (
      !height.safeParse(openingHeight).success ||
      (bottom !== undefined && (!Number.isFinite(bottom) || bottom < 0 || bottom > 600)) ||
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
