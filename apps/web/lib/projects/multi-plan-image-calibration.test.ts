import type { PlanImageCalibration, PlanImageDimensionLine } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  planImageScaleCheck,
  planImageScaleCoverage,
  validPlanImageCalibration,
} from './plan-image-calibration'

// Координаты прочитаны вручную с локальных снимков; тест не утверждает точность обмера.
const planWithBedroom: PlanImageCalibration = {
  imageWidthPx: 1095,
  imageHeightPx: 1098,
  pixelStart: { x: 101, y: 44 },
  pixelEnd: { x: 541, y: 44 },
  worldStart: { xCm: 100, yCm: 100 },
  lengthCm: 420,
  direction: 'right',
  verificationLines: [
    { pixelStart: { x: 541, y: 44 }, pixelEnd: { x: 963, y: 44 }, lengthCm: 400 },
    { pixelStart: { x: 50, y: 116 }, pixelEnd: { x: 50, y: 500 }, lengthCm: 370 },
  ],
}

const planWithTwoWindows: PlanImageCalibration = {
  imageWidthPx: 1161,
  imageHeightPx: 1189,
  pixelStart: { x: 195, y: 103 },
  pixelEnd: { x: 575, y: 103 },
  worldStart: { xCm: 100, yCm: 100 },
  lengthCm: 280,
  direction: 'right',
  verificationLines: [
    { pixelStart: { x: 308, y: 103 }, pixelEnd: { x: 511, y: 103 }, lengthCm: 150 },
    { pixelStart: { x: 122, y: 295 }, pixelEnd: { x: 122, y: 513 }, lengthCm: 160 },
    { pixelStart: { x: 575, y: 103 }, pixelEnd: { x: 973, y: 103 }, lengthCm: 282.5 },
  ],
}

function results(calibration: PlanImageCalibration) {
  return (calibration.verificationLines ?? []).map((line: PlanImageDimensionLine) =>
    planImageScaleCheck(calibration, line),
  )
}

describe('сверка масштаба на других квартирных планах', () => {
  it('finds matching horizontal and vertical dimensions on the bedroom plan', () => {
    expect(validPlanImageCalibration(planWithBedroom, 1000, 1000)).toBe(true)
    expect(results(planWithBedroom).every((result) => result.consistent)).toBe(true)
    expect(planImageScaleCoverage(planWithBedroom)).toMatchObject({
      checks: 2,
      hasSecondDirection: true,
      hasConflict: false,
    })
  })

  it('flags a questionable outer width while other axes agree on the two-window plan', () => {
    expect(validPlanImageCalibration(planWithTwoWindows, 1000, 1000)).toBe(true)
    expect(results(planWithTwoWindows).map((result) => result.consistent)).toEqual([
      true,
      true,
      false,
    ])
    expect(planImageScaleCoverage(planWithTwoWindows)).toMatchObject({
      hasSecondDirection: true,
      hasConflict: true,
    })
  })
})
