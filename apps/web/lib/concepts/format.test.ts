import type { FitVerdict } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { fitLabel, sizeLabel } from './format'

describe('fitLabel', () => {
  it.each([
    ['itemDimensions', 'Для проверки уточните полные размеры товара'],
    ['roomDimensions', 'Для проверки укажите размеры комнаты'],
    ['wallMeasurements', 'Для проверки измерьте свободный участок стены'],
  ] as const)('объясняет неопределённость: %s', (reason, label) => {
    expect(fitLabel({ state: 'unknown', reason })).toBe(label)
  })

  it('положительный ответ называет именно проверку размеров', () => {
    const fit: FitVerdict = {
      state: 'fits',
      itemCm: 120,
      spot: { name: 'стена слева', widthCm: 200 },
    }
    expect(fitLabel(fit)).toBe('Помещается по длине: стена слева 200 см')
  })

  it('distinguishes a tight fit and an installation allowance from excess object height', () => {
    expect(
      fitLabel({ state: 'tight', itemCm: 198, spot: { name: 'стена слева', widthCm: 200 } }),
    ).toContain('Уточните монтажный запас')
    const label = fitLabel({ state: 'tooTall', ceilingCm: 240, itemCm: 100, overCm: 2 })
    expect(label).toContain('выше потолка (240 см) на 2 см')
  })

  it('показывает дробное превышение и отдельно поясняет небольшой зазор для сборки', () => {
    const spot = { name: 'простенок', widthCm: 184.8 }
    expect(fitLabel({ state: 'tooWide', itemCm: 185, overCm: 185 - 184.8, spot })).toContain(
      'шире на 0,2 см',
    )
    expect(
      fitLabel({ state: 'unknown', reason: 'roomDimensions', ceilingGapCm: 237 - 236.4 }),
    ).toBe(
      'Для проверки укажите размеры комнаты. До потолка 0,6 см. Проверьте высоту для сборки по инструкции товара.',
    )
  })

  it('keeps incomplete positive verdicts as a request for dimensions', () => {
    expect(fitLabel({ state: 'fits' })).toBe('Для проверки подтвердите размеры')
    expect(fitLabel({ state: 'unknown' })).toBe('Для проверки подтвердите размеры')
  })
})

describe('sizeLabel', () => {
  it('labels partial dimensions by axis instead of implying a full footprint', () => {
    expect(sizeLabel({ height: 80 })).toBe('высота 80 см')
    expect(sizeLabel({ width: 210, height: 80 })).toBe('ширина 210 см, высота 80 см')
    expect(sizeLabel({ depth: 90 })).toBe('глубина 90 см')
    expect(sizeLabel({})).toBeNull()
    expect(sizeLabel(null)).toBeNull()
  })

  it('keeps compact ordered dimensions when both footprint axes are known', () => {
    expect(sizeLabel({ width: 210, depth: 90 })).toBe('210 × 90 см')
    expect(sizeLabel({ width: 210, depth: 90, height: 80 })).toBe('210 × 90 × 80 см')
  })
})
