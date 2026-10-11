import { compareDecimalSums } from '@uyut/catalog/plan-exact-geometry'
import { describe, expect, it } from 'vitest'
import {
  enclosingDecimalSum,
  enclosingTurnBounds,
  enclosingTurnSide,
} from './plan-transfer-enclosure'

describe('certified transfer enclosures', () => {
  it.each([
    [[0.1, 0.2], [0.3], 0],
    [[300, 1e-14], [300], 1],
    [[-15, 0.2], [-14.8], 0],
    [[-5e-324], [0], -1],
    [[], [], 0],
  ])('compares decimal sums without intermediate rounding: %j', (left, right, result) => {
    expect(compareDecimalSums(left as number[], right as number[])).toBe(result)
  })
  it.each([
    [180, 1e-14, 1e-14],
    [0.1, 0.2],
    [-15, 1e-14],
  ])('encloses an expanded profile outside rather than rounding below it: %j', (...values) => {
    expect(compareDecimalSums([enclosingDecimalSum(values)], values)).toBeGreaterThanOrEqual(0)
  })
  it('keeps the diagonal and endpoint radius outside a cancelling near-zero boundary', () => {
    const side = enclosingTurnSide(10, 22)
    expect(side).toBeDefined()
    if (side === undefined) throw new Error('Missing diagonal enclosure')
    const bounds = enclosingTurnBounds({ xCm: 12.083045973594572, yCm: 30 }, 10, 22, side)
    expect(bounds?.[0]).toBeLessThan(0)
  })
  it('rejects non-finite arithmetic instead of certifying it', () => {
    expect(() => compareDecimalSums([Number.NaN], [0])).toThrow()
    expect(() => enclosingDecimalSum([Number.POSITIVE_INFINITY])).toThrow()
  })
})
