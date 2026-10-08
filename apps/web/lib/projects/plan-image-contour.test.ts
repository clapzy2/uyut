import type { PlanImageCalibration } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { imageContourFromMetric, traceImageContour } from './plan-image-contour'

const calibration: PlanImageCalibration = {
  imageWidthPx: 820,
  imageHeightPx: 970,
  pixelStart: { x: 110, y: 110 },
  pixelEnd: { x: 710, y: 110 },
  lengthCm: 600,
  worldStart: { xCm: 40, yCm: 40 },
  direction: 'right',
  verificationLines: [
    { pixelStart: { x: 110, y: 110 }, pixelEnd: { x: 110, y: 710 }, lengthCm: 600 },
  ],
}
const balcony = [
  { xCm: 390, yCm: 670 },
  { xCm: 640, yCm: 670 },
  { xCm: 640, yCm: 740 },
  { xCm: 590, yCm: 790 },
  { xCm: 390, yCm: 790 },
]

describe('human image contour tracing', () => {
  it('preserves the five-vertex diagonal balcony through calibrated image coordinates', () => {
    const pixels = imageContourFromMetric(balcony, calibration)
    expect(pixels).toEqual(balcony.map((p) => ({ x: p.xCm + 70, y: p.yCm + 70 })))
    expect(traceImageContour(pixels, calibration, 680, 830, 30)).toEqual(balcony)
  })
  it('round trips a rotated source without exchanging width/depth', () => {
    const rotated = {
      ...calibration,
      pixelEnd: { x: 110, y: 710 },
      verificationLines: [
        { pixelStart: { x: 110, y: 110 }, pixelEnd: { x: 710, y: 110 }, lengthCm: 600 },
      ],
    }
    const contour = [
      { xCm: 40, yCm: 40 },
      { xCm: 140, yCm: 40 },
      { xCm: 140, yCm: 140 },
    ]
    expect(
      traceImageContour(imageContourFromMetric(contour, rotated), rotated, 680, 830, 30),
    ).toEqual(contour)
  })
  it('does not apply a single-axis or conflicting calibration', () => {
    const pixels = imageContourFromMetric(balcony, calibration)
    expect(
      traceImageContour(pixels, { ...calibration, verificationLines: [] }, 680, 830, 30),
    ).toBeUndefined()
    expect(
      traceImageContour(
        pixels,
        {
          ...calibration,
          verificationLines: [
            { pixelStart: { x: 110, y: 110 }, pixelEnd: { x: 110, y: 710 }, lengthCm: 400 },
          ],
        },
        680,
        830,
        30,
      ),
    ).toBeUndefined()
  })
  it.each(
    [
      [
        { x: 110, y: 110 },
        { x: 210, y: 110 },
      ],
      [
        { x: 110, y: 110 },
        { x: 210, y: 210 },
        { x: 210, y: 110 },
        { x: 110, y: 210 },
      ],
      [
        { x: 110, y: 110 },
        { x: 210, y: 110 },
        { x: 110, y: 110 },
      ],
      [
        { x: 0, y: 0 },
        { x: 210, y: 110 },
        { x: 110, y: 210 },
      ],
      [
        { x: 110, y: 110 },
        { x: 900, y: 110 },
        { x: 110, y: 210 },
      ],
      [
        { x: 110, y: 110 },
        { x: Number.NaN, y: 110 },
        { x: 110, y: 210 },
      ],
    ].map((points) => ({ points })),
  )('rejects invalid traces without clamping or changing existing geometry', ({ points }) => {
    expect(traceImageContour(points, calibration, 680, 830, 30)).toBeUndefined()
  })
  it('enforces the room vertex limit', () => {
    expect(
      traceImageContour(imageContourFromMetric(balcony, calibration), calibration, 680, 830, 4),
    ).toBeUndefined()
  })
})
