import { describe, expect, it } from 'vitest'
import { rectInsideFloor } from '../../../../packages/catalog/src/layout'

const rectangle = [
  { xCm: 0, yCm: 0 },
  { xCm: 100, yCm: 0 },
  { xCm: 100, yCm: 100 },
  { xCm: 0, yCm: 100 },
] as const
describe('continuous contour containment', () => {
  it('accepts exact boundary contact, but not sub-centimetre protrusion', () => {
    expect(rectInsideFloor({ xCm: 0, yCm: 0, widthCm: 100, depthCm: 100 }, rectangle)).toBe(true)
    expect(rectInsideFloor({ xCm: 0, yCm: 0, widthCm: 100.1, depthCm: 100 }, rectangle)).toBe(false)
  })
  it('rejects a narrow notch missed by nine sample points', () => {
    const notched = [
      rectangle[0],
      { xCm: 19, yCm: 0 },
      { xCm: 19, yCm: 30 },
      { xCm: 21, yCm: 30 },
      { xCm: 21, yCm: 0 },
      rectangle[1],
      rectangle[2],
      rectangle[3],
    ]
    expect(rectInsideFloor({ xCm: 0, yCm: 0, widthCm: 100, depthCm: 100 }, notched)).toBe(false)
    expect(rectInsideFloor({ xCm: 30, yCm: 0, widthCm: 60, depthCm: 40 }, notched)).toBe(true)
    expect(
      rectInsideFloor({ xCm: 0, yCm: 0, widthCm: 100, depthCm: 100 }, [...notched].reverse()),
    ).toBe(false)
  })
})
