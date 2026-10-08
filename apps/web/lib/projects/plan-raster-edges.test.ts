import { describe, expect, it } from 'vitest'
import { detectPlanRasterEdges } from './plan-raster-edges'

function raster(width: number, height: number, ink: (x: number, y: number) => boolean) {
  const grayscale = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grayscale[y * width + x] = ink(x, y) ? 0 : 255
  }
  return { grayscale, width, height }
}

describe('unclassified raster boundary candidates', () => {
  it('retains rectangle corners in source pixel coordinates', () => {
    const result = detectPlanRasterEdges(
      raster(100, 100, (x, y) => x >= 20 && x < 80 && y >= 30 && y < 70),
    )
    expect(result.segments).toHaveLength(4)
    expect(result.points).toEqual(
      expect.arrayContaining([
        { x: 20, y: 30 },
        { x: 80, y: 30 },
        { x: 80, y: 70 },
        { x: 20, y: 70 },
      ]),
    )
    expect(result.truncated).toBe(false)
    expect(result.uncertain).toBe(false)
  })

  it('preserves a staircase diagonal rather than making it orthogonal', () => {
    const result = detectPlanRasterEdges(
      raster(120, 120, (x, y) => x >= 20 && x < 100 && y >= 20 && y < 100 && x + y < 160),
    )
    const diagonal = result.segments.find(
      ({ start, end }) => Math.abs(end.x - start.x) > 30 && Math.abs(end.y - start.y) > 30,
    )
    expect(diagonal).toBeDefined()
    if (!diagonal) throw new Error('Missing diagonal candidate')
    expect(
      Math.abs(
        Math.abs(diagonal.end.x - diagonal.start.x) - Math.abs(diagonal.end.y - diagonal.start.y),
      ),
    ).toBeLessThanOrEqual(2)
  })

  it('ignores tiny disconnected glyph-like ink', () => {
    expect(
      detectPlanRasterEdges(raster(100, 100, (x, y) => x % 12 < 3 && y % 12 < 4)).segments,
    ).toEqual([])
  })

  it('returns no invented geometry on blank paper', () => {
    expect(detectPlanRasterEdges(raster(80, 90, () => false))).toEqual({
      segments: [],
      points: [],
      truncated: false,
      uncertain: false,
    })
  })
  it('does not manufacture an image-frame rectangle from fully cropped ink', () => {
    const result = detectPlanRasterEdges(raster(100, 100, () => true))
    expect(result.points).toEqual([])
    expect(result.segments).toEqual([])
  })
  it('never offers the clipped image frame as a corner', () => {
    const result = detectPlanRasterEdges(raster(100, 100, (x, y) => x < 70 && y >= 20 && y < 80))
    expect(result.points.length).toBeGreaterThan(0)
    expect(
      result.points.every((point) => point.x > 0 && point.y > 0 && point.x < 100 && point.y < 100),
    ).toBe(true)
  })

  it('rejects malformed and oversized buffers', () => {
    for (const input of [
      { grayscale: new Uint8Array(1), width: 0, height: 1 },
      { grayscale: new Uint8Array(1), width: 1.5, height: 1 },
      { grayscale: new Uint8Array(1), width: 2, height: 1 },
      { grayscale: new Uint8Array(2001), width: 2001, height: 1 },
    ])
      expect(() => detectPlanRasterEdges(input)).toThrow(RangeError)
  })

  it('fails safely on excessive checkerboard boundaries', () => {
    const result = detectPlanRasterEdges(raster(400, 400, (x, y) => (x + y) % 2 === 0))
    expect(result).toEqual({ segments: [], points: [], truncated: true, uncertain: true })
  })

  it('bounds output when many large disconnected objects resemble edges', () => {
    const result = detectPlanRasterEdges(raster(800, 800, (x, y) => x % 30 < 20 && y % 30 < 20))
    expect(result.truncated).toBe(true)
    expect(result.uncertain).toBe(true)
    expect(result.segments).toHaveLength(2000)
    expect(result.points.length).toBeLessThanOrEqual(4000)
  })

  it('handles rotated pixels without changing coordinate convention', () => {
    const original = raster(
      130,
      100,
      (x, y) => x >= 20 && x < 110 && y >= 10 && y < 80 && x + y < 160,
    )
    const rotated = raster(
      original.height,
      original.width,
      (x, y) => original.grayscale[(original.height - 1 - x) * original.width + y] === 0,
    )
    const first = detectPlanRasterEdges(original)
    const second = detectPlanRasterEdges(rotated)
    expect(second.segments).toHaveLength(first.segments.length)
    for (const point of first.points) {
      expect(
        second.points.some(
          (candidate) =>
            Math.hypot(candidate.x - (original.height - point.y), candidate.y - point.x) <= 1.5,
        ),
      ).toBe(true)
    }
  })

  it('does not bridge separated ink strips or assert openings', () => {
    const result = detectPlanRasterEdges(
      raster(120, 80, (x, y) => y >= 30 && y < 34 && ((x >= 10 && x < 45) || (x >= 65 && x < 110))),
    )
    expect(
      result.segments.some(
        ({ start, end }) => Math.min(start.x, end.x) < 45 && Math.max(start.x, end.x) > 65,
      ),
    ).toBe(false)
    expect(result.points.length).toBeLessThanOrEqual(4000)
  })
})
