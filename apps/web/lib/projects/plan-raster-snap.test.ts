import { describe, expect, it } from 'vitest'
import { rasterCornerResponse, snapRasterCorner } from './plan-raster-snap'

describe('optional source pixel corner assistance', () => {
  it('returns a nearby candidate without modifying pointer or candidate arrays', () => {
    const point = { x: 103, y: 104 },
      candidates = [{ x: 100, y: 100 }]
    expect(snapRasterCorner(point, candidates)).toEqual({ x: 100, y: 100 })
    expect(point).toEqual({ x: 103, y: 104 })
  })
  it('does not guess among ambiguous or distant points', () => {
    expect(
      snapRasterCorner({ x: 10, y: 10 }, [
        { x: 9, y: 10 },
        { x: 11, y: 10 },
      ]),
    ).toBeUndefined()
    expect(snapRasterCorner({ x: 10, y: 10 }, [{ x: 20, y: 20 }])).toBeUndefined()
  })
  const response = {
    source: { width: 820, height: 970, page: 1, sha256: 'a'.repeat(64) },
    points: [{ x: 110, y: 110 }],
    truncated: false,
    uncertain: false,
  }
  it('accepts only matching complete source evidence', () => {
    expect(rasterCornerResponse(response, 820, 970, 1, 'a'.repeat(64))).toEqual(response.points)
  })
  it.each([
    { ...response, truncated: true },
    { ...response, uncertain: true },
    { ...response, source: { ...response.source, page: 2 } },
    { ...response, source: { ...response.source, width: 821 } },
    { ...response, source: { ...response.source, sha256: 'b'.repeat(64) } },
    { ...response, points: [{ x: 900, y: 10 }] },
    { ...response, points: [{ x: '110', y: 110 }] },
  ])('rejects stale, incomplete or malformed source candidates', (data) => {
    expect(rasterCornerResponse(data, 820, 970, 1, 'a'.repeat(64))).toBeUndefined()
  })
})
