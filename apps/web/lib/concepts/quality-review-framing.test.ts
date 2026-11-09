import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareLocalizedOpeningCheck } from '../../../../packages/ai/src/quality-review-framing'

// Fixed, nonrepeating texture gives every part of the frame a recognizable position.
async function texturedFrame(seed: number) {
  const side = 28
  const pixels = Buffer.alloc(side * side)
  let state = seed
  for (let i = 0; i < pixels.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    pixels[i] = state >>> 24
  }
  return sharp(pixels, { raw: { width: side, height: side, channels: 1 } })
    .resize(192, 192)
    .png()
    .toBuffer()
}

describe('localized change in a fixed frame', () => {
  const box = [0.25, 0.25, 0.375, 0.5]
  const site = { left: 48, top: 48, width: 72, height: 96 }

  async function replaceSite(frame: Buffer, patch: Buffer) {
    return sharp(frame)
      .composite([{ left: site.left, top: site.top, input: patch }])
      .png()
      .toBuffer()
  }

  it('admits a sizable structural edit only at the supplied location, in either order', async () => {
    const original = await texturedFrame(42)
    const patch = await sharp(await texturedFrame(81))
      .extract(site)
      .png()
      .toBuffer()
    const changed = await replaceSite(original, patch)
    const check = await prepareLocalizedOpeningCheck(original, changed)
    const reverse = await prepareLocalizedOpeningCheck(changed, original)
    expect(check?.(box)).toBe(true)
    expect(reverse?.(box)).toBe(true)
    expect(check?.([0.64, 0.25, 0.35, 0.5])).toBe(false)
    expect(check?.([0.4, 0.4, 0.04, 0.04])).toBe(false)
    const shifted = await sharp(changed)
      .extract({ left: 6, top: 0, width: 186, height: 186 })
      .resize(192, 192)
      .png()
      .toBuffer()
    expect(await prepareLocalizedOpeningCheck(original, shifted)).toBeNull()
  })

  it('rejects unchanged structure, global or local exposure changes, and small objects', async () => {
    const original = await texturedFrame(42)
    const brighter = await sharp(original).linear(0.75, 60).png().toBuffer()
    const litSite = await sharp(brighter).extract(site).png().toBuffer()
    const small = await sharp({
      create: { width: 14, height: 16, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer()
    for (const result of [
      original,
      brighter,
      await replaceSite(original, litSite),
      await replaceSite(original, small),
    ]) {
      const check = await prepareLocalizedOpeningCheck(original, result)
      expect(check?.(box)).toBe(false)
    }
  })

  it('requires a coherent change on a flat wall even when the background is locked', async () => {
    const background = await texturedFrame(42)
    const wall = Buffer.alloc(site.width * site.height, 145)
    const noisy = wall.map(
      (value, i) => value + ((i + Math.floor(i / site.width)) % 2 === 0 ? 40 : -40),
    )
    const raw = { width: site.width, height: site.height, channels: 1 as const }
    const original = await replaceSite(background, await sharp(wall, { raw }).png().toBuffer())
    for (const values of [Buffer.alloc(wall.length, 80), noisy]) {
      const changed = await replaceSite(background, await sharp(values, { raw }).png().toBuffer())
      const check = await prepareLocalizedOpeningCheck(original, changed)
      expect(check?.(box)).toBe(false)
    }
  })
})
