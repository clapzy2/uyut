import type { PlanImageCalibration } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  planImageMatrix,
  planImageScaleCheck,
  validPlanImageCalibration,
} from './plan-image-calibration'

const calibration: PlanImageCalibration = {
  imageWidthPx: 1000,
  imageHeightPx: 800,
  pixelStart: { x: 100, y: 200 },
  pixelEnd: { x: 300, y: 200 },
  worldStart: { xCm: 50, yCm: 70 },
  lengthCm: 400,
  direction: 'right',
}

function transformed(matrix: readonly number[], point: { x: number; y: number }) {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = matrix
  return { xCm: a * point.x + c * point.y + e, yCm: b * point.x + d * point.y + f }
}

describe('plan image calibration', () => {
  it('maps the selected image interval to the labelled size in centimetres', () => {
    expect(validPlanImageCalibration(calibration, 600, 500)).toBe(true)
    const matrix = planImageMatrix(calibration)
    expect(transformed(matrix, calibration.pixelStart).xCm).toBeCloseTo(50)
    expect(transformed(matrix, calibration.pixelEnd).xCm).toBeCloseTo(450)
    expect(transformed(matrix, calibration.pixelEnd).yCm).toBeCloseTo(70)
  })

  it('rotates a slanted source interval to the chosen plan axis', () => {
    const slanted = {
      ...calibration,
      pixelEnd: { x: 220, y: 360 },
      direction: 'down' as const,
    }
    expect(validPlanImageCalibration(slanted, 600, 500)).toBe(true)
    const matrix = planImageMatrix(slanted)
    expect(transformed(matrix, slanted.pixelEnd).xCm).toBeCloseTo(50)
    expect(transformed(matrix, slanted.pixelEnd).yCm).toBeCloseTo(470)
  })

  it('rejects zero-length, off-image and off-canvas anchors', () => {
    expect(
      validPlanImageCalibration({ ...calibration, pixelEnd: calibration.pixelStart }, 600, 500),
    ).toBe(false)
    expect(
      validPlanImageCalibration({ ...calibration, pixelEnd: { x: 1200, y: 200 } }, 600, 500),
    ).toBe(false)
    expect(validPlanImageCalibration({ ...calibration, lengthCm: 700 }, 600, 500)).toBe(false)
  })

  it('places the 3039 mm line from the 28.8 m² reference plan at about 304 cm', () => {
    // Точки по локальному скриншоту плана — только визуальная sanity-проверка, не обмер.
    const apartment = {
      ...calibration,
      imageWidthPx: 903,
      imageHeightPx: 847,
      pixelStart: { x: 458, y: 94 },
      pixelEnd: { x: 814, y: 94 },
      worldStart: { xCm: 400, yCm: 90 },
      lengthCm: 303.9,
    }
    expect(validPlanImageCalibration(apartment, 900, 800)).toBe(true)
    const matrix = planImageMatrix(apartment)
    expect(transformed(matrix, apartment.pixelEnd).xCm).toBeCloseTo(703.9)
    expect(transformed(matrix, { x: 0, y: 0 }).xCm).toBeGreaterThan(0)
    expect(transformed(matrix, { x: 903, y: 847 }).yCm).toBeLessThan(800)
  })

  it('compares independent dimensions and flags the inconsistent segment', () => {
    const apartment = {
      ...calibration,
      pixelStart: { x: 458, y: 94 },
      pixelEnd: { x: 812, y: 94 },
      lengthCm: 303.9,
    }
    const bottom = planImageScaleCheck(apartment, {
      pixelStart: { x: 234, y: 808 },
      pixelEnd: { x: 398, y: 808 },
      lengthCm: 140,
    })
    const left = planImageScaleCheck(apartment, {
      pixelStart: { x: 35, y: 300 },
      pixelEnd: { x: 35, y: 519 },
      lengthCm: 186.9,
    })
    const right = planImageScaleCheck(apartment, {
      pixelStart: { x: 879, y: 400 },
      pixelEnd: { x: 879, y: 706 },
      lengthCm: 251.6,
    })
    expect(bottom.consistent).toBe(true)
    expect(left.consistent).toBe(true)
    expect(right.consistent).toBe(false)
  })

  it('rejects malformed independent dimension evidence', () => {
    expect(
      validPlanImageCalibration(
        {
          ...calibration,
          verificationLines: [
            { pixelStart: { x: 0, y: 0 }, pixelEnd: { x: 1, y: 1 }, lengthCm: 140 },
          ],
        },
        600,
        500,
      ),
    ).toBe(false)
  })
})
