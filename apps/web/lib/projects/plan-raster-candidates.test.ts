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

  it('offers a fully enclosed local light area in original image coordinates', async () => {
    const width = 900
    const height = 800
    const grayscale = Buffer.alloc(width * height, 255)
    for (let y = 350; y < 450; y++) {
      for (let x = 400; x < 500; x++) {
        if (x < 404 || x >= 496 || y < 354 || y >= 446) grayscale[y * width + x] = 0
      }
    }
    const image = await sharp(grayscale, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const focused = await rasterPlanCandidates(image, false, 1, { x: 450, y: 400 })
    expect(focused.focused).toBe(true)
    expect(focused.regionUncertain).toBe(true)
    expect(focused.regionTruncated).toBe(false)
    expect(focused.sourceStrokeGuide).toBeUndefined()
    expect(focused.regions).toEqual([
      expect.objectContaining({
        polygon: [
          { x: 404, y: 354 },
          { x: 496, y: 354 },
          { x: 496, y: 446 },
          { x: 404, y: 446 },
        ],
      }),
    ])
  })

  it('does not close a light area that continues beyond the focused crop', async () => {
    const width = 900
    const height = 800
    const grayscale = Buffer.alloc(width * height, 255)
    for (let y = 250; y < 550; y++) {
      for (let x = 180; x < 350; x++) {
        if (x < 184 || x >= 346 || y < 254 || y >= 546) grayscale[y * width + x] = 0
      }
    }
    const image = await sharp(grayscale, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const focused = await rasterPlanCandidates(image, false, 1, { x: 450, y: 400 })
    expect(focused.regions).toEqual([])
    expect(focused.regionUncertain).toBe(true)
  })

  it('expands the search when the clicked room is wider than the first crop', async () => {
    const width = 1100
    const height = 1000
    const grayscale = Buffer.alloc(width * height, 255)
    for (let y = 150; y < 850; y++) {
      for (let x = 200; x < 900; x++) {
        if (x < 204 || x >= 896 || y < 154 || y >= 846) grayscale[y * width + x] = 0
      }
    }
    const image = await sharp(grayscale, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const focused = await rasterPlanCandidates(image, false, 1, { x: 550, y: 500 })
    expect(focused.focused).toBe(true)
    expect(focused.regionUncertain).toBe(true)
    expect(focused.regions).toEqual([
      expect.objectContaining({
        polygon: [
          { x: 204, y: 154 },
          { x: 896, y: 154 },
          { x: 896, y: 846 },
          { x: 204, y: 846 },
        ],
      }),
    ])
  })

  it('does not invent closure when a larger border has an opening', async () => {
    const width = 1100
    const height = 1000
    const grayscale = Buffer.alloc(width * height, 255)
    for (let y = 150; y < 850; y++) {
      for (let x = 200; x < 900; x++) {
        const gap = y >= 450 && y < 550 && x >= 896
        if (!gap && (x < 204 || x >= 896 || y < 154 || y >= 846)) grayscale[y * width + x] = 0
      }
    }
    const image = await sharp(grayscale, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const focused = await rasterPlanCandidates(image, false, 1, { x: 550, y: 500 })
    expect(focused.regions).toEqual([])
    expect(focused.regionUncertain).toBe(true)
  })
})
