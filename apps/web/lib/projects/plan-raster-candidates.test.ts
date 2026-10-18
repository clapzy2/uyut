import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { rasterPlanCandidates } from './plan-raster-candidates'

describe('focused raster guides', () => {
  it('recovers source-pixel corners where a dense unrelated part exhausts the page scan', async () => {
    const width = 900
    const height = 800
    const grayscale = Buffer.alloc(width * height, 255)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((y < 100 && (x + y) % 2 === 0) || (x >= 400 && x < 500 && y >= 350 && y < 450))
          grayscale[y * width + x] = 0
      }
    }
    const image = await sharp(grayscale, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const page = await rasterPlanCandidates(image, false, 1)
    expect(page.truncated).toBe(true)
    expect(page.points).toEqual([])

    const focused = await rasterPlanCandidates(image, false, 1, { x: 450, y: 400 })
    expect(focused.focused).toBe(true)
    expect(focused.uncertain).toBe(true)
    expect(focused.truncated).toBe(false)
    expect(focused.regions).toEqual([])
    expect(focused.points).toEqual(
      expect.arrayContaining([
        { x: 400, y: 350 },
        { x: 500, y: 350 },
        { x: 500, y: 450 },
        { x: 400, y: 450 },
      ]),
    )
  })

  it('never treats a cropped ink strip as a source-image corner', async () => {
    const width = 900
    const height = 800
    const grayscale = Buffer.alloc(width * height, 255)
    for (let y = 200; y < 600; y++) {
      for (let x = 200; x < 350; x++) grayscale[y * width + x] = 0
    }
    const image = await sharp(grayscale, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const result = await rasterPlanCandidates(image, false, 1, { x: 450, y: 400 })
    expect(result.points.every((point) => point.x > 200 && point.x < 700)).toBe(true)
    expect(result.points.every((point) => point.y > 150 && point.y < 650)).toBe(true)
    await expect(rasterPlanCandidates(image, false, 1, { x: 900, y: 400 })).rejects.toThrow(
      RangeError,
    )
  })
})
