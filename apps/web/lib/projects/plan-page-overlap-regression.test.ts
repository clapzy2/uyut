import { describe, expect, it } from 'vitest'
import apartment from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { polygonsOverlap, polygonWithin, segmentEntersPolygon } from './plan-page-review'
import type { PagePoint } from './plan-pdf-linework'

// Existing-state SPB page 2, native operations 3324/3637. These different
// wall pieces meet at a mitre; neither is a duplicate or an overlapping redraw.
const mitreLeft: PagePoint[] = [
  { x: 84.374, y: 22.339 },
  { x: 84.374, y: 23.328 },
  { x: 81.008, y: 23.328 },
  { x: 81.008, y: 26.184 },
  { x: 72.931, y: 26.184 },
  { x: 72.931, y: 14.248 },
]
const mitreTop: PagePoint[] = [
  { x: 72.931, y: 14.248 },
  { x: 91.161, y: 14.248 },
  { x: 91.161, y: 19.959 },
  { x: 87.123, y: 19.959 },
  { x: 87.123, y: 22.339 },
  { x: 84.374, y: 22.339 },
]

// First apartment page 6, native operation 737: original vertices retained.
const apartmentWall: PagePoint[] = [
  { x: 455.069, y: 67.952 },
  { x: 455.069, y: 65.572 },
  { x: 458.434, y: 65.572 },
  { x: 458.434, y: 59.86 },
  { x: 337.278, y: 59.86 },
  { x: 337.278, y: 65.096 },
  { x: 340.643, y: 65.096 },
  { x: 340.643, y: 67.476 },
  { x: 341.99, y: 81.757 },
  { x: 405.956, y: 81.757 },
  { x: 405.956, y: 281.919 },
  { x: 400.231, y: 281.919 },
  { x: 400.231, y: 285.489 },
  { x: 405.255, y: 285.489 },
  { x: 472.507, y: 331.329 },
  { x: 499.438, y: 331.329 },
  { x: 499.438, y: 327.76 },
  { x: 474.527, y: 327.76 },
  { x: 410.697, y: 284.251 },
  { x: 410.697, y: 82.233 },
  { x: 453.722, y: 82.233 },
]

describe('native decimal diagonal boundary regressions', () => {
  it('allows the exact SPB mitre for both polygon orders and windings', () => {
    for (const left of [mitreLeft, [...mitreLeft].reverse()]) {
      for (const right of [mitreTop, [...mitreTop].reverse()]) {
        expect(polygonsOverlap(left, right)).toBe(false)
        expect(polygonsOverlap(right, left)).toBe(false)
      }
    }
  })

  it('does not treat an exact original shared diagonal as entering either wall', () => {
    const a = { x: 72.931, y: 14.248 }
    const b = { x: 84.374, y: 22.339 }
    for (const wall of [mitreLeft, mitreTop]) {
      expect(segmentEntersPolygon(a, b, wall)).toBe(false)
      expect(segmentEntersPolygon(b, a, wall)).toBe(false)
    }
  })

  it('preserves identical-polygon overlap and containment', () => {
    expect(polygonsOverlap(mitreLeft, [...mitreLeft].reverse())).toBe(true)
    expect(polygonWithin(mitreLeft, [...mitreLeft].reverse())).toBe(true)
  })

  it('refuses polygons whose shared original diagonal has both interiors on the same side', () => {
    const first = [
      { x: 72.931, y: 14.248 },
      { x: 84.374, y: 22.339 },
      { x: 72.931, y: 26.184 },
    ]
    const second = [
      { x: 72.931, y: 14.248 },
      { x: 84.374, y: 22.339 },
      { x: 72.931, y: 23.328 },
    ]
    for (const polygon of [second, [...second].reverse()]) {
      expect(polygonsOverlap(first, polygon)).toBe(true)
      expect(polygonsOverlap(polygon, first)).toBe(true)
    }
  })

  it('still refuses a real small intrusion rather than adding a boundary allowance', () => {
    const shifted = mitreTop.map((point) => ({ ...point, y: point.y + 0.000000001 }))
    expect(polygonsOverlap(mitreLeft, shifted)).toBe(true)
    expect(polygonsOverlap(shifted, mitreLeft)).toBe(true)
  })

  it('allows a small real gap without snapping the polygons together', () => {
    const shifted = mitreTop.map((point) => ({ ...point, y: point.y - 0.000000001 }))
    expect(polygonsOverlap(mitreLeft, shifted)).toBe(false)
    expect(polygonsOverlap(shifted, mitreLeft)).toBe(false)
  })

  it.each([1, 3])('keeps the first apartment wall outside room %i', (number) => {
    const room = apartment.rooms.find((candidate) =>
      'roomSourceNumbers' in candidate
        ? candidate.roomSourceNumbers?.includes(number)
        : candidate.roomSourceNumber === number,
    )
    expect(room).toBeDefined()
    if (!room) return
    expect(polygonsOverlap(apartmentWall, room.polygon)).toBe(false)
    expect(polygonsOverlap(room.polygon, apartmentWall)).toBe(false)
  })
})
