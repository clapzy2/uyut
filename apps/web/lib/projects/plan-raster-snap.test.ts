import { describe, expect, it } from 'vitest'
import {
  rasterCornerResponse,
  rasterRegionAt,
  rasterRegionResponse,
  rasterRegionStraightEdges,
  snapRasterCorner,
} from './plan-raster-snap'

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

  const region = {
    id: 'region-583',
    polygon: [
      { x: 500, y: 700 },
      { x: 800, y: 700 },
      { x: 800, y: 830 },
      { x: 500, y: 830 },
    ],
    hasInteriorIslands: true,
  }
  const regionResponse = {
    ...response,
    regions: [region],
    regionTruncated: false,
    regionUncertain: true,
  }
  it('selects only an unclassified source-bound region under the user point', () => {
    const guides = rasterRegionResponse(regionResponse, 820, 970, 1, 'a'.repeat(64))
    expect(guides).toEqual({ regions: [region], uncertain: true })
    expect(rasterRegionAt({ x: 650, y: 780 }, guides?.regions ?? [])).toEqual(region)
    expect(rasterRegionAt({ x: 400, y: 780 }, guides?.regions ?? [])).toBeUndefined()
    expect(
      rasterRegionAt({ x: 650, y: 780 }, [region, { ...region, id: 'region-584' }]),
    ).toBeUndefined()
  })
  it('highlights long straight pixel stretches without joining short arc segments', () => {
    const guide = {
      id: 'region-1',
      polygon: [
        { x: 0, y: 0 },
        { x: 8, y: 4 },
        { x: 14, y: 11 },
        { x: 16, y: 20 },
        { x: 100, y: 20 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      hasInteriorIslands: false,
    }
    expect(rasterRegionStraightEdges(guide, 200, 160)).toEqual([
      { start: { x: 16, y: 20 }, end: { x: 100, y: 20 } },
      { start: { x: 100, y: 20 }, end: { x: 100, y: 100 } },
      { start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ])
    expect(rasterRegionStraightEdges(guide, 0, 160)).toEqual([])
  })
  it.each([
    { ...regionResponse, regionTruncated: true },
    { ...regionResponse, source: { ...response.source, page: 2 } },
    { ...regionResponse, source: { ...response.source, width: 821 } },
    { ...regionResponse, source: { ...response.source, sha256: 'b'.repeat(64) } },
    { ...regionResponse, regions: [{ ...region, polygon: region.polygon.slice(0, 2) }] },
    {
      ...regionResponse,
      regions: [{ ...region, polygon: [{ x: 900, y: 700 }, ...region.polygon] }],
    },
    { ...regionResponse, regions: [region, region] },
    {
      ...regionResponse,
      regions: [
        {
          ...region,
          polygon: [region.polygon[0], region.polygon[2], region.polygon[1], region.polygon[3]],
        },
      ],
    },
  ])('rejects stale, truncated or malformed bright-region guides', (data) => {
    expect(rasterRegionResponse(data, 820, 970, 1, 'a'.repeat(64))).toBeUndefined()
  })
})
