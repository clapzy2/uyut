import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { rasterPlanCandidates } from './plan-raster-candidates'

describe('source pixel candidate preparation', () => {
  it('restores analysis pixels to original image coordinates after bounded downsampling', async () => {
    const image = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="600"><rect width="3000" height="600" fill="white"/><rect x="2200" y="100" width="400" height="400" fill="black"/></svg>',
      ),
    )
      .png()
      .toBuffer()
    const result = await rasterPlanCandidates(image, false, 1)
    expect(result.width).toBe(3000)
    expect(result.height).toBe(600)
    expect(result.truncated).toBe(false)
    expect(result.points.some((point) => Math.hypot(point.x - 2600, point.y - 500) <= 2)).toBe(true)
    expect(
      result.points.every(
        (point) => point.x >= 0 && point.y >= 0 && point.x <= 3000 && point.y <= 600,
      ),
    ).toBe(true)
  })
  it('does not fabricate candidates on blank images', async () => {
    const image = await sharp({
      create: { width: 300, height: 200, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer()
    const result = await rasterPlanCandidates(image, false, 1)
    expect(result.points).toEqual([])
    expect(result.segments).toEqual([])
  })
  it('rejects a broken input before producing pixel evidence', async () => {
    await expect(rasterPlanCandidates(Buffer.from('not an image'), false, 1)).rejects.toThrow()
  })
})
