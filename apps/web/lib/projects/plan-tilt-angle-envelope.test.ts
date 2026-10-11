import { integerPoints } from '@uyut/catalog/plan-exact-geometry'
import { describe, expect, it } from 'vitest'
import { tiltedBoxEnvelope } from './plan-tilt-angle-envelope'

describe('certified entered tilt pose', () => {
  it('keeps exact upright and laid-down endpoints', () => {
    expect(tiltedBoxEnvelope(120.1, 180.2, 0)).toEqual({ extentCm: 120.1, heightCm: 180.2 })
    expect(tiltedBoxEnvelope(120.1, 180.2, 90)).toEqual({ extentCm: 180.2, heightCm: 120.1 })
  })

  it.each([
    [120, 180],
    [0.1, 0.2],
    [10, 22],
    [999.9999999999999, 0.0000000000001],
  ])('bounds the independently known 45-degree sqrt(2) solution: %s, %s', (width, height) => {
    const result = tiltedBoxEnvelope(width, height, 45)
    expect(result).toBeDefined()
    if (!result) throw new Error('Missing envelope')
    const [body, pose] = integerPoints([
      { xCm: width, yCm: height },
      { xCm: result.extentCm, yCm: result.heightCm },
    ])
    if (!body || !pose) throw new Error('Missing exact decimal coordinates')
    const squaredSum = (body.x + body.y) ** 2n
    expect(2n * pose.x ** 2n >= squaredSum).toBe(true)
    expect(2n * pose.y ** 2n >= squaredSum).toBe(true)
    expect(result.extentCm).toBeCloseTo((width + height) / Math.SQRT2, 10)
  })

  it.each([30, 60])('bounds the independent sin/cos exact radicals at %s degrees', (angle) => {
    const result = tiltedBoxEnvelope(120.1, 180.2, angle)
    if (!result) throw new Error('Missing envelope')
    const [body, pose] = integerPoints([
      { xCm: 120.1, yCm: 180.2 },
      { xCm: result.extentCm, yCm: result.heightCm },
    ])
    if (!body || !pose) throw new Error('Missing exact decimal coordinates')
    const extentRadical = angle === 30 ? 2n * pose.x - body.y : 2n * pose.x - body.x
    const heightRadical = angle === 30 ? 2n * pose.y - body.x : 2n * pose.y - body.y
    expect(extentRadical > 0n).toBe(true)
    expect(heightRadical > 0n).toBe(true)
    expect(extentRadical ** 2n >= 3n * (angle === 30 ? body.x : body.y) ** 2n).toBe(true)
    expect(heightRadical ** 2n >= 3n * (angle === 30 ? body.y : body.x) ** 2n).toBe(true)
  })

  it.each([0.000000001, 0.1, 12.3456789, 37.2, 89.99999999999999])(
    'accepts fractional %s-degree poses without rounding to a preset angle',
    (angle) => {
      const result = tiltedBoxEnvelope(40, 180, angle)
      if (!result) throw new Error('Missing envelope')
      const radians = (angle * Math.PI) / 180
      // Numerical accuracy smoke check; the radical tests above are independent proof checks.
      expect(result.extentCm).toBeCloseTo(40 * Math.cos(radians) + 180 * Math.sin(radians), 10)
      expect(result.heightCm).toBeCloseTo(40 * Math.sin(radians) + 180 * Math.cos(radians), 10)
    },
  )

  it('makes partial tilts tighter than the whole-rotation diagonal', () => {
    const result = tiltedBoxEnvelope(40, 180, 12.5)
    expect(result?.extentCm).toBeLessThan(80)
    expect(result?.heightCm).toBeLessThan(Math.hypot(40, 180))
    expect(result?.extentCm).toBeGreaterThan(40)
  })

  it('does not round a minute positive entered angle back to the exact upright box', () => {
    const result = tiltedBoxEnvelope(40, 180, Number.MIN_VALUE)
    expect(result?.extentCm).toBeGreaterThan(40)
    expect(result?.heightCm).toBeGreaterThanOrEqual(180)
  })

  it('holds overflow rather than certifying infinite output', () => {
    expect(tiltedBoxEnvelope(Number.MAX_VALUE, Number.MAX_VALUE, 45)).toBeUndefined()
  })

  it.each([
    [0, 180, 45],
    [-1, 180, 45],
    [40, 0, 45],
    [40, -1, 45],
    [40, 180, -1],
    [40, 180, 90.000000000001],
    [40, 180, 360],
    [Number.NaN, 180, 45],
    [40, Number.POSITIVE_INFINITY, 45],
    [40, 180, Number.NaN],
    [40, 180, Number.NEGATIVE_INFINITY],
  ])('rejects invalid dimensions/angle %j', (width, height, angle) => {
    expect(tiltedBoxEnvelope(width, height, angle)).toBeUndefined()
  })
})
