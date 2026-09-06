import {
  buildTranscript,
  hexToHsl,
  hslToRgb,
  isApproximate,
  looksLikeToolCall,
  maskWeights,
  meanLightness,
  parseAgentReply,
  recolorPixels,
  rgbToHsl,
  swatchAvailability,
  swatches,
} from '@uyut/ai'
import { describe, expect, it } from 'vitest'

describe('swatches', () => {
  it('тридцать материалов с уникальными id', () => {
    expect(swatches).toHaveLength(30)
    expect(new Set(swatches.map((swatch) => swatch.id)).size).toBe(30)
  })

  it('ткань к дивану доступна, металл только во второй версии, дерево к столу доступно', () => {
    const linen = swatches.find((swatch) => swatch.id === 'linen-light')
    const brass = swatches.find((swatch) => swatch.id === 'hard-brass')
    const oak = swatches.find((swatch) => swatch.id === 'wood-oak')
    if (!linen || !brass || !oak) throw new Error('нет свотчей')
    expect(swatchAvailability('sofa', linen)).toBe('ok')
    expect(swatchAvailability('sofa', brass)).toBe('v2')
    expect(swatchAvailability('sofa', oak)).toBe('v2')
    expect(swatchAvailability('table', oak)).toBe('ok')
    expect(swatchAvailability('table', linen)).toBe('v2')
  })

  it('«приблизительно» при сильном сдвиге светлоты', () => {
    const milk = swatches.find((swatch) => swatch.id === 'linen-milk')
    const grey = swatches.find((swatch) => swatch.id === 'linen-grey')
    if (!milk || !grey) throw new Error('нет свотчей')
    expect(isApproximate(0.15, milk)).toBe(true)
    expect(isApproximate(0.5, grey)).toBe(false)
  })

  it('hex ↔ hsl ↔ rgb сходятся', () => {
    const hsl = hexToHsl('#7c2f3b')
    const [r, g, b] = hslToRgb(hsl.h, hsl.s, hsl.l)
    expect(Math.round(r * 255)).toBe(0x7c)
    expect(Math.round(g * 255)).toBe(0x2f)
    expect(Math.round(b * 255)).toBe(0x3b)
    expect(rgbToHsl(1, 1, 1)).toEqual({ h: 0, s: 0, l: 1 })
  })
})

describe('recolor', () => {
  // Картинка 2×1: левый пиксель серый под маской, правый красный вне маски
  function scene() {
    const pixels = new Uint8ClampedArray([128, 128, 128, 255, 200, 40, 40, 255])
    const mask = new Float32Array([1, 0])
    return { pixels, mask }
  }

  it('пиксели под маской получают целевой тон, вне маски не трогаются', () => {
    const { pixels, mask } = scene()
    const source = meanLightness(pixels, mask)
    expect(source).toBeCloseTo(128 / 255, 3)
    const touched = recolorPixels(pixels, mask, { h: 1 / 3, s: 0.6, l: 0.5 }, source)
    expect(touched).toBe(1)
    const left = rgbToHsl((pixels[0] ?? 0) / 255, (pixels[1] ?? 0) / 255, (pixels[2] ?? 0) / 255)
    expect(left.h).toBeCloseTo(1 / 3, 1)
    expect(left.s).toBeGreaterThan(0.3)
    expect([pixels[4], pixels[5], pixels[6]]).toEqual([200, 40, 40])
  })

  it('растушёвка маски даёт мягкий край', () => {
    // 5×5: белый квадрат 3×3 в центре. Центр остаётся единицей, край размывается, угол чист.
    const size = 5
    const maskPixels = new Uint8ClampedArray(size * size * 4)
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        maskPixels[(y * size + x) * 4] = 255
      }
    }
    const weights = maskWeights(maskPixels, size, size, 1)
    expect(weights[2 * size + 2]).toBeCloseTo(1, 5)
    const edge = weights[1 * size + 1] ?? 0
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
    const outside = weights[0 * size + 1] ?? 0
    expect(outside).toBeGreaterThan(0)
    expect(outside).toBeLessThan(edge)
    expect(weights[0]).toBeGreaterThan(0)
    expect(weights[0]).toBeLessThan(outside)
  })
})

describe('chat protocol', () => {
  it('команда в JSON распознаётся, в том числе в code fence', () => {
    expect(parseAgentReply('{"tool":"search_catalog","args":{"category":"sofa"}}')).toEqual({
      type: 'tool',
      name: 'search_catalog',
      args: { category: 'sofa' },
    })
    expect(parseAgentReply('```json\n{"tool":"estimate","args":{}}\n```')).toEqual({
      type: 'tool',
      name: 'estimate',
      args: {},
    })
  })

  it('неизвестный инструмент и обычный текст остаются текстом', () => {
    expect(parseAgentReply('{"tool":"drop_database","args":{}}').type).toBe('text')
    expect(parseAgentReply('Стены белые, потому что…')).toEqual({
      type: 'text',
      text: 'Стены белые, потому что…',
    })
  })

  it('начало команды угадывается по первой скобке', () => {
    expect(looksLikeToolCall('  {"tool"')).toBe(true)
    expect(looksLikeToolCall('Стены')).toBe(false)
  })

  it('в расшифровку попадают только последние ходы', () => {
    const turns = Array.from({ length: 30 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `сообщение ${index}`,
    }))
    const transcript = buildTranscript(turns, 20)
    expect(transcript).not.toContain('сообщение 9')
    expect(transcript).toContain('сообщение 10')
    expect(transcript.endsWith('Помощник:')).toBe(true)
  })
})
