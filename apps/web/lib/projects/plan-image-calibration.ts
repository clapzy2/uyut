import type { PlanImageCalibration, PlanImageDimensionLine } from '@uyut/db'

type PixelPoint = PlanImageCalibration['pixelStart']

function validPixelPoint(point: PixelPoint, width: number, height: number): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= width &&
    point.y <= height
  )
}

function validDimensionLine(
  line: unknown,
  width: number,
  height: number,
): line is PlanImageDimensionLine {
  if (!line || typeof line !== 'object') return false
  const candidate = line as Partial<PlanImageDimensionLine>
  const start = candidate.pixelStart
  const end = candidate.pixelEnd
  const length = candidate.lengthCm
  return Boolean(
    start &&
      end &&
      validPixelPoint(start, width, height) &&
      validPixelPoint(end, width, height) &&
      Math.hypot(end.x - start.x, end.y - start.y) >= 10 &&
      Number.isFinite(length) &&
      length !== undefined &&
      length >= 20 &&
      length <= 5_000 &&
      Number.isInteger(length * 10),
  )
}

/** Сверка второй подписанной линии не предполагает, что по одному растру известны все стены. */
export function planImageScaleCheck(
  calibration: PlanImageCalibration,
  line: PlanImageDimensionLine,
) {
  const primaryPixels = Math.hypot(
    calibration.pixelEnd.x - calibration.pixelStart.x,
    calibration.pixelEnd.y - calibration.pixelStart.y,
  )
  const checkPixels = Math.hypot(
    line.pixelEnd.x - line.pixelStart.x,
    line.pixelEnd.y - line.pixelStart.y,
  )
  const measuredCm = (checkPixels * calibration.lengthCm) / primaryPixels
  const deviationCm = measuredCm - line.lengthCm
  // Толщина линий и ручной клик дают несколько пикселей неопределённости.
  const toleranceCm = Math.max(2, line.lengthCm * 0.02, (6 * calibration.lengthCm) / primaryPixels)
  return { measuredCm, deviationCm, toleranceCm, consistent: Math.abs(deviationCm) <= toleranceCm }
}

/** Размеры вдоль одной оси не обнаружат растяжение картинки поперёк неё. */
export function planImageScaleCoverage(calibration: PlanImageCalibration) {
  const primaryX = calibration.pixelEnd.x - calibration.pixelStart.x
  const primaryY = calibration.pixelEnd.y - calibration.pixelStart.y
  const primaryLength = Math.hypot(primaryX, primaryY)
  const lines = calibration.verificationLines ?? []
  const hasSecondDirection = lines.some((line) => {
    const dx = line.pixelEnd.x - line.pixelStart.x
    const dy = line.pixelEnd.y - line.pixelStart.y
    const length = Math.hypot(dx, dy)
    return length > 0 && Math.abs(primaryX * dy - primaryY * dx) / (primaryLength * length) >= 0.85
  })
  return {
    checks: lines.length,
    hasSecondDirection,
    hasConflict: lines.some((line) => !planImageScaleCheck(calibration, line).consistent),
  }
}

/** Один размер задаёт масштаб и поворот, а положение первой точки — сдвиг картинки. */
export function planImageMatrix(
  calibration: PlanImageCalibration,
): [number, number, number, number, number, number] {
  const dx = calibration.pixelEnd.x - calibration.pixelStart.x
  const dy = calibration.pixelEnd.y - calibration.pixelStart.y
  const pixelLength = Math.hypot(dx, dy)
  const targetAngle = {
    right: 0,
    down: Math.PI / 2,
    left: Math.PI,
    up: -Math.PI / 2,
  }[calibration.direction]
  const rotation = targetAngle - Math.atan2(dy, dx)
  const scale = calibration.lengthCm / pixelLength
  const a = scale * Math.cos(rotation)
  const b = scale * Math.sin(rotation)
  const c = -b
  const d = a
  const e = calibration.worldStart.xCm - a * calibration.pixelStart.x - c * calibration.pixelStart.y
  const f = calibration.worldStart.yCm - b * calibration.pixelStart.x - d * calibration.pixelStart.y
  return [a, b, c, d, e, f]
}

/** Проверка пользовательской привязки до записи в проект. */
export function validPlanImageCalibration(
  value: unknown,
  canvasWidthCm: number,
  canvasHeightCm: number,
): value is PlanImageCalibration {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<PlanImageCalibration>
  const imageWidthPx = source.imageWidthPx
  const imageHeightPx = source.imageHeightPx
  const start = source.pixelStart
  const end = source.pixelEnd
  const world = source.worldStart
  const length = source.lengthCm
  if (
    !Number.isInteger(imageWidthPx) ||
    !Number.isInteger(imageHeightPx) ||
    !imageWidthPx ||
    !imageHeightPx ||
    imageWidthPx < 100 ||
    imageHeightPx < 100 ||
    imageWidthPx > 20_000 ||
    imageHeightPx > 20_000 ||
    !start ||
    !end ||
    !world ||
    !Number.isFinite(length) ||
    length === undefined ||
    !Number.isInteger(length * 10) ||
    length < 20 ||
    length > 5_000 ||
    !['right', 'left', 'down', 'up'].includes(source.direction ?? '')
  )
    return false
  if (
    !validPixelPoint(start, imageWidthPx, imageHeightPx) ||
    !validPixelPoint(end, imageWidthPx, imageHeightPx)
  )
    return false
  if (Math.hypot(end.x - start.x, end.y - start.y) < 10) return false
  if (!Number.isFinite(world.xCm) || !Number.isFinite(world.yCm)) return false
  const verificationLines = source.verificationLines
  if (
    verificationLines !== undefined &&
    (!Array.isArray(verificationLines) ||
      verificationLines.length > 6 ||
      new Set(verificationLines.map((line) => JSON.stringify(line))).size !==
        verificationLines.length ||
      !verificationLines.every((line) => validDimensionLine(line, imageWidthPx, imageHeightPx)))
  )
    return false

  const second = {
    xCm:
      world.xCm +
      (source.direction === 'right' ? length : source.direction === 'left' ? -length : 0),
    yCm:
      world.yCm + (source.direction === 'down' ? length : source.direction === 'up' ? -length : 0),
  }
  return [world, second].every(
    (point) =>
      point.xCm >= 0 && point.yCm >= 0 && point.xCm <= canvasWidthCm && point.yCm <= canvasHeightCm,
  )
}
