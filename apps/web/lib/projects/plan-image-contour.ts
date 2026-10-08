import type { PlanImageCalibration, PlanPoint } from '@uyut/db'
import { validMetricPolygon } from './plan-geometry-inspection'
import {
  planImageConfirmationIssue,
  planImageMatrix,
  validPlanImageCalibration,
} from './plan-image-calibration'

export type ImageContourPoint = { x: number; y: number }

/** Convert only a human trace using its reviewed scale. Never clamp or rectangularize vertices. */
export function traceImageContour(
  points: readonly ImageContourPoint[],
  calibration: PlanImageCalibration,
  widthCm: number,
  heightCm: number,
  maxPoints: number,
): PlanPoint[] | undefined {
  if (
    !validPlanImageCalibration(calibration, widthCm, heightCm) ||
    planImageConfirmationIssue(calibration) ||
    points.length > maxPoints
  )
    return undefined
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > calibration.imageWidthPx ||
        p.y > calibration.imageHeightPx,
    )
  )
    return undefined
  const [a, b, c, d, e, f] = planImageMatrix(calibration)
  const contour = points.map(({ x, y }) => ({
    xCm: Math.round((a * x + c * y + e) * 10) / 10,
    yCm: Math.round((b * x + d * y + f) * 10) / 10,
  }))
  return validMetricPolygon(contour, { widthCm, heightCm }) ? contour : undefined
}

/** Existing metric draft shown back on the exact image, not an AI coordinate guess. */
export function imageContourFromMetric(
  points: readonly PlanPoint[],
  calibration: PlanImageCalibration,
): ImageContourPoint[] {
  const [a, b, c, d, e, f] = planImageMatrix(calibration)
  const determinant = a * d - b * c
  return points.map(({ xCm, yCm }) => ({
    x: (d * (xCm - e) - c * (yCm - f)) / determinant,
    y: (a * (yCm - f) - b * (xCm - e)) / determinant,
  }))
}
