import { describe, expect, it } from 'vitest'
import { bindObservedRegionLabels } from './plan-raster-region-labels'
import { detectPlanRasterRegions as detectPlanRasterFreeRegions } from './plan-raster-regions'

function raster(width: number, height: number, bright: (x: number, y: number) => boolean) {
  const grayscale = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grayscale[y * width + x] = bright(x, y) ? 255 : 0
  }
  return { grayscale, width, height }
}

describe('experimental free pixel regions', () => {
  it('uses observed component membership to exclude an enclosing sheet background', () => {
    const source = { sha256: 'a'.repeat(64), page: 1, width: 180, height: 120 }
    const labels = [
      { id: 'left', name: 'Спальня', point: { x: 50.5, y: 50.5 } },
      { id: 'right', name: 'Кухня', point: { x: 130.5, y: 50.5 } },
    ]
    const pixels = raster(180, 120, (x, y) => {
      const sheet = x >= 5 && x < 175 && y >= 5 && y < 115
      const building = x >= 30 && x < 150 && y >= 25 && y < 95
      const rooms = x >= 35 && x < 145 && y >= 30 && y < 90 && !(x >= 88 && x < 92)
      return sheet && (!building || rooms)
    })
    const detected = detectPlanRasterFreeRegions({
      ...pixels,
      probes: labels.map(({ id, point }) => ({ id, point })),
    })
    expect(detected.regions).toHaveLength(3)
    const input = { regionSource: source, labelSource: source, regions: detected.regions, labels }
    expect(bindObservedRegionLabels(input).assignments).toEqual([])
    const bound = bindObservedRegionLabels({
      ...input,
      pixelMembership: { source, points: detected.pointMembership ?? [] },
    })
    expect(bound.assignments).toHaveLength(2)
    expect(bound.unresolvedLabelIds).toEqual([])
    expect(new Set(bound.assignments.map((entry) => entry.regionId)).size).toBe(2)
    expect(bound.status).toBe('draft')
  })
  it('returns no membership for ink, small islands or frame-touching components', () => {
    const pixels = raster(100, 100, (x, y) => x < 5 || (x >= 30 && x < 40 && y >= 30 && y < 40))
    const result = detectPlanRasterFreeRegions({
      ...pixels,
      probes: [
        { id: 'frame', point: { x: 2, y: 20 } },
        { id: 'small', point: { x: 35, y: 35 } },
        { id: 'ink', point: { x: 60, y: 60 } },
      ],
    })
    expect(result.pointMembership?.map((entry) => entry.regionId)).toEqual([null, null, null])
  })
  it('rejects duplicate or out-of-frame probes', () => {
    const pixels = raster(100, 100, () => false)
    expect(() =>
      detectPlanRasterFreeRegions({
        ...pixels,
        probes: [{ id: 'edge', point: { x: 100, y: 50 } }],
      }),
    ).toThrow()
    const probe = { id: 'same', point: { x: 20, y: 20 } }
    expect(() => detectPlanRasterFreeRegions({ ...pixels, probes: [probe, probe] })).toThrow()
  })
  it('rejects an RDP shortcut that crosses another simplified edge', () => {
    const rectangles = [
      [38, 65, 5, 9],
      [25, 69, 20, 6],
      [27, 62, 19, 3],
      [48, 60, 17, 16],
      [44, 48, 15, 19],
    ]
    const result = detectPlanRasterFreeRegions(
      raster(100, 100, (x, y) =>
        rectangles.some(
          ([left = 0, top = 0, width = 0, height = 0]) =>
            x >= left && x < left + width && y >= top && y < top + height,
        ),
      ),
    )
    expect(result.regions).toEqual([])
    expect(result.uncertain).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.rejectedRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'self-intersecting-polygon', pixelArea: 671 }),
      ]),
    )
  })
  it('returns an enclosed rectangle in pixel-cell coordinates', () => {
    const result = detectPlanRasterFreeRegions(
      raster(100, 100, (x, y) => x >= 20 && x < 80 && y >= 30 && y < 70),
    )
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]).toMatchObject({
      pixelArea: 2_400,
      bounds: { minX: 20, minY: 30, maxX: 80, maxY: 70 },
      hasInteriorIslands: false,
    })
    expect(result.regions[0]?.polygon).toEqual([
      { x: 20, y: 30 },
      { x: 80, y: 30 },
      { x: 80, y: 70 },
      { x: 20, y: 70 },
    ])
    expect(result.truncated).toBe(false)
    expect(result.uncertain).toBe(false)
  })

  it('retains a diagonal rather than rectifying a cropped corner', () => {
    const result = detectPlanRasterFreeRegions(
      raster(120, 120, (x, y) => x >= 20 && x < 100 && y >= 20 && y < 100 && x + y < 160),
    )
    const polygon = result.regions[0]?.polygon ?? []
    expect(polygon.length).toBeGreaterThanOrEqual(5)
    expect(
      polygon.some((start, index) => {
        const end = polygon[(index + 1) % polygon.length]
        return end && Math.abs(end.x - start.x) > 25 && Math.abs(end.y - start.y) > 25
      }),
    ).toBe(true)
    expect(result.regions[0]?.hasInteriorIslands).toBe(false)
  })

  it('keeps adjoining spaces merged through an open doorway', () => {
    const result = detectPlanRasterFreeRegions(
      raster(
        120,
        100,
        (x, y) => x >= 10 && x < 110 && y >= 10 && y < 90 && (x !== 60 || (y >= 40 && y < 60)),
      ),
    )
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]?.pixelArea).toBe(7_940)
    expect(result.regions[0]?.polygon.length).toBeGreaterThan(4)
  })

  it('excludes exterior and frame-touching cropped interiors without closing them', () => {
    const result = detectPlanRasterFreeRegions(
      raster(120, 100, (x, y) => x < 45 || (x >= 70 && x < 110 && y >= 20 && y < 80)),
    )
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]?.bounds.minX).toBe(70)
    expect(result.uncertain).toBe(false)
    expect(detectPlanRasterFreeRegions(raster(100, 100, () => true)).regions).toEqual([])
  })

  it('flags text/ink islands but does not turn them into rooms or fill their pixels', () => {
    const result = detectPlanRasterFreeRegions(
      raster(
        100,
        100,
        (x, y) =>
          x >= 10 && x < 90 && y >= 10 && y < 90 && !(x >= 40 && x < 50 && y >= 40 && y < 50),
      ),
    )
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]?.pixelArea).toBe(6_300)
    expect(result.regions[0]?.hasInteriorIslands).toBe(true)
    expect(result.uncertain).toBe(true)
  })

  it('does not merge diagonally touching isolated noise', () => {
    const result = detectPlanRasterFreeRegions(raster(200, 200, (x, y) => (x + y) % 2 === 0))
    expect(result.regions).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('separates an ink island touching the outer boundary at a diagonal vertex', () => {
    const result = detectPlanRasterFreeRegions(
      raster(
        100,
        100,
        (x, y) =>
          x >= 10 &&
          x < 90 &&
          y >= 10 &&
          y < 90 &&
          !(x < 20 && y < 20) &&
          !(x >= 20 && x < 30 && y >= 20 && y < 30),
      ),
    )
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]?.pixelArea).toBe(6_200)
    expect(result.regions[0]?.hasInteriorIslands).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.uncertain).toBe(true)
    expect(result.rejectedRegions).toEqual([])
    const polygon = result.regions[0]?.polygon ?? []
    const area =
      polygon.reduce((total, start, index) => {
        const end = polygon[(index + 1) % polygon.length]
        return end ? total + start.x * end.y - end.x * start.y : total
      }, 0) / 2
    expect(area).toBe(6_300)
  })

  it('uses the brightness threshold and excludes sub-400 pixel components', () => {
    const input = raster(100, 100, (x, y) => x >= 20 && x < 40 && y >= 20 && y < 40)
    input.grayscale = input.grayscale.map((value) => (value === 255 ? 180 : 179))
    expect(detectPlanRasterFreeRegions(input).regions[0]?.pixelArea).toBe(400)
    input.grayscale[20 * 100 + 20] = 179
    expect(detectPlanRasterFreeRegions(input).regions).toEqual([])
  })

  it('rejects a boundary too detailed for a bounded polygon', () => {
    const result = detectPlanRasterFreeRegions(
      raster(600, 100, (x, y) => x >= 10 && x < 590 && y >= 10 && y < 90 && (y >= 25 || x % 5 < 3)),
    )
    expect(result.regions).toEqual([])
    expect(result.truncated).toBe(true)
    expect(result.uncertain).toBe(true)
    expect(result.rejectedRegions[0]?.reason).toBe('polygon-point-limit')
  })

  it('bounds the number of output regions and explicitly marks truncation', () => {
    const result = detectPlanRasterFreeRegions(
      raster(
        500,
        500,
        (x, y) =>
          x >= 10 && y >= 10 && x < 490 && y < 490 && (x - 10) % 60 < 30 && (y - 10) % 60 < 30,
      ),
    )
    expect(result.regions).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.uncertain).toBe(true)
  })

  it('preserves area and rotated bounds under a 90 degree rotation', () => {
    const input = raster(120, 100, (x, y) => x >= 20 && x < 100 && y >= 10 && y < 80 && x + y < 150)
    const rotated = raster(100, 120, (x, y) => (input.grayscale[(99 - x) * 120 + y] ?? 0) >= 180)
    const original = detectPlanRasterFreeRegions(input).regions[0]
    const result = detectPlanRasterFreeRegions(rotated).regions[0]
    expect(result?.pixelArea).toBe(original?.pixelArea)
    expect(result?.bounds).toEqual({ minX: 20, minY: 20, maxX: 90, maxY: 100 })
  })

  it('rejects excessive boundary work instead of pretending it has a valid contour', () => {
    const result = detectPlanRasterFreeRegions(
      raster(
        600,
        600,
        (x, y) => x >= 2 && x < 598 && y >= 2 && y < 598 && (y % 2 === 0 || x === 2),
      ),
    )
    expect(result.regions).toEqual([])
    expect(result.truncated).toBe(true)
    expect(result.uncertain).toBe(true)
    expect(result.rejectedRegions[0]?.reason).toBe('region-boundary-limit')
  })

  it('accepts the bounded maximum raster and rejects malformed dimensions', () => {
    expect(
      detectPlanRasterFreeRegions({
        grayscale: new Uint8Array(4_000_000),
        width: 2_000,
        height: 2_000,
      }).regions,
    ).toEqual([])
    expect(() =>
      detectPlanRasterFreeRegions({ grayscale: new Uint8Array(1), width: 2_001, height: 1 }),
    ).toThrow(RangeError)
    expect(() =>
      detectPlanRasterFreeRegions({ grayscale: new Uint8Array(1), width: 1.5, height: 1 }),
    ).toThrow(RangeError)
    expect(() =>
      detectPlanRasterFreeRegions({ grayscale: new Uint8Array(3), width: 2, height: 2 }),
    ).toThrow(RangeError)
  })
})
