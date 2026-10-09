import { describe, expect, it } from 'vitest'
import { exactNativePolygonContains } from './plan-native-exact-intersections'

const box = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
describe('inclusive exact containment of validated source polygons', () => {
  it.each([box(1, 1, 9, 9), box(0, 0, 10, 10), box(0, 1, 9, 9)].map((inner) => ({ inner })))(
    'allows interior and boundary-only contact %j without changing coordinates',
    ({ inner }) => {
      const outer = box(0, 0, 10, 10)
      const before = structuredClone({ outer, inner })
      expect(exactNativePolygonContains(outer, inner)).toBe(true)
      expect(exactNativePolygonContains([...outer].reverse(), [...inner].reverse())).toBe(true)
      expect({ outer, inner }).toEqual(before)
    },
  )
  it('does not snap a source vertex just outside the containing boundary', () => {
    expect(exactNativePolygonContains(box(1, 1, 10, 10), box(0.9999999999999999, 2, 9, 9))).toBe(
      false,
    )
  })
  it('detects an outside interval between boundary vertices in a concave envelope', () => {
    const outer = [
      { x: 25, y: 100 },
      { x: 125, y: 100 },
      { x: 125, y: 250 },
      { x: 25, y: 250 },
      { x: 25, y: 200 },
      { x: 110, y: 200 },
      { x: 110, y: 150 },
      { x: 25, y: 150 },
    ]
    expect(exactNativePolygonContains(outer, box(50, 150, 100, 200))).toBe(false)
    expect(exactNativePolygonContains(outer, box(111, 150, 124, 200))).toBe(true)
  })
  it('checks vertex-only crossings away from the whole-edge midpoint', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 5 },
      { x: 2, y: 7 },
      { x: 3, y: 7 },
      { x: 3, y: 5 },
      { x: 3, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    // All corners and the top-edge midpoint (5,5) are inside; (2.5,5) is not.
    expect(exactNativePolygonContains(outer, box(1, 5, 9, 9))).toBe(false)
  })
  it('allows a tangent notch tip but rejects proper edge crossings', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 5 },
      { x: 6, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(exactNativePolygonContains(outer, box(1, 5, 9, 9))).toBe(true)
    expect(exactNativePolygonContains(outer, box(1, 4, 9, 9))).toBe(false)
  })
  it('does not call a disjoint polygon contained', () => {
    expect(exactNativePolygonContains(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(false)
  })
  it('refuses unsupported source precision rather than rounding to a boundary', () => {
    expect(exactNativePolygonContains(box(0, 0, 10, 10), box(1e-20, 1, 9, 9))).toBeNull()
  })
  it('does not claim containment for a zero-area polygon', () => {
    expect(
      exactNativePolygonContains(box(0, 0, 10, 10), [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ]),
    ).toBeNull()
  })
  it('agrees with analytic C-envelope containment for boundary and near-boundary rectangle sweeps', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 75 },
      { x: 75, y: 75 },
      { x: 75, y: 25 },
      { x: 0, y: 25 },
    ]
    const xs = [0, 25, 50, 74.99999999999999, 75, 100, 100.01]
    const ys = [0, 25, 25.01, 50, 74.99, 75, 100]
    for (const left of xs)
      for (const right of xs) {
        if (left >= right) continue
        for (const top of ys)
          for (const bottom of ys) {
            if (top >= bottom) continue
            const expected = right <= 100 && (bottom <= 25 || top >= 75 || left >= 75)
            expect(
              exactNativePolygonContains(outer, box(left, top, right, bottom)),
              `${left},${top}..${right},${bottom}`,
            ).toBe(expected)
          }
      }
  })
})
