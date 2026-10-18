import { describe, expect, it } from 'vitest'
import {
  rasterCandidateSourceSha256,
  rasterCornerResponse,
  rasterLabelPoint,
  rasterRegionAt,
  rasterRegionResponse,
  rasterRegionStraightEdges,
  rasterRegionTraceDraft,
  snapRasterCorner,
} from './plan-raster-snap'

describe('optional source pixel corner assistance', () => {
  it('shows a model label only on the identical source and page', () => {
    const anchor = { x: 400, y: 500, sourceSha256: 'a'.repeat(64), page: 1 }
    const source = { width: 1000, height: 800, sha256: 'a'.repeat(64), page: 1 }
    expect(rasterLabelPoint(anchor, source)).toEqual({ x: 400, y: 400 })
    expect(rasterLabelPoint(anchor, { ...source, sha256: 'b'.repeat(64) })).toBeUndefined()
    expect(rasterLabelPoint(anchor, { ...source, page: 2 })).toBeUndefined()
    expect(rasterLabelPoint({ ...anchor, y: -1 }, source)).toBeUndefined()
    expect(rasterLabelPoint({ ...anchor, x: Number.NaN }, source)).toBeUndefined()
  })
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
    expect(rasterCandidateSourceSha256(response, 820, 970, 1)).toBe('a'.repeat(64))
    expect(rasterCandidateSourceSha256(response, 820, 970, 2)).toBeUndefined()
  })
  it('allows explicitly closed source contours when the inventory is incomplete', () => {
    const partial = {
      ...response,
      truncated: true,
      uncertain: true,
      partialClosedContours: true,
    }
    expect(rasterCornerResponse(partial, 820, 970, 1, 'a'.repeat(64))).toEqual(response.points)
    expect(
      rasterCornerResponse(
        { ...partial, partialClosedContours: false },
        820,
        970,
        1,
        'a'.repeat(64),
      ),
    ).toBeUndefined()
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
  it('offers an editable Wedge balcony outline without erasing its diagonal', () => {
    const polygon = [
      [234, 1776],
      [510, 1776],
      [512, 1792],
      [643, 1792],
      [645, 1776],
      [688, 1776],
      [688, 1789],
      [690, 1792],
      [726, 1793],
      [595, 1967],
      [590, 1963],
      [550, 1947],
      [550, 1945],
      [541, 1943],
      [526, 1934],
      [516, 1932],
      [481, 1914],
      [474, 1913],
      [447, 1899],
      [443, 1899],
      [428, 1890],
      [423, 1890],
      [394, 1875],
      [390, 1875],
      [384, 1870],
      [374, 1868],
      [345, 1853],
      [331, 1849],
      [296, 1831],
      [292, 1831],
      [209, 1793],
      [233, 1792],
    ].map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }))
    const guide = { id: 'region-63', polygon, hasInteriorIslands: true }
    const draft = rasterRegionTraceDraft(guide, 30)
    expect(draft).toHaveLength(30)
    expect(draft).toContainEqual({ x: 726, y: 1793 })
    expect(draft).toContainEqual({ x: 595, y: 1967 })
    expect(guide.polygon).toHaveLength(32)
    expect(rasterRegionTraceDraft(guide, 3)).toBeUndefined()
  })
  it('does not cut a detailed polygon down beyond two source pixels', () => {
    const guide = {
      id: 'region-1',
      polygon: Array.from({ length: 32 }, (_, index) => ({
        x: 100 + 80 * Math.cos((index * 2 * Math.PI) / 32),
        y: 100 + 80 * Math.sin((index * 2 * Math.PI) / 32),
      })),
      hasInteriorIslands: false,
    }
    expect(rasterRegionTraceDraft(guide, 4)).toBeUndefined()
    expect(rasterRegionTraceDraft(guide, 32)).toHaveLength(32)
    expect(rasterRegionTraceDraft(guide, 2)).toBeUndefined()
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
      { start: { x: 16, y: 20 }, end: { x: 100, y: 20 }, connectedAtBothEnds: false },
      { start: { x: 100, y: 20 }, end: { x: 100, y: 100 }, connectedAtBothEnds: true },
      { start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, connectedAtBothEnds: true },
      { start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, connectedAtBothEnds: false },
    ])
    expect(rasterRegionStraightEdges(guide, 0, 160)).toEqual([])
  })
  it('omits isolated long edges between short pixel stretches', () => {
    const guide = {
      id: 'region-2',
      polygon: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 62, y: 5 },
        { x: 64, y: 10 },
        { x: 70, y: 12 },
        { x: 70, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 5 },
      ],
      hasInteriorIslands: false,
    }
    const edges = rasterRegionStraightEdges(guide, 200, 160)
    expect(
      edges.some(({ start, end }) => start.x === 0 && start.y === 0 && end.x === 60 && end.y === 0),
    ).toBe(false)
    expect(edges).toHaveLength(3)
    expect(edges.map((edge) => edge.connectedAtBothEnds)).toEqual([false, true, false])
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
