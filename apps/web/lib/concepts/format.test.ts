import type { FitVerdict } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { fitLabel } from './format'

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
    expect(label).toContain('не хватает 2 см с учётом запаса для установки')
    expect(label).not.toContain('выше потолка')
  })

  it('keeps incomplete positive verdicts as a request for dimensions', () => {
    expect(fitLabel({ state: 'fits' })).toBe('Для проверки подтвердите размеры')
    expect(fitLabel({ state: 'unknown' })).toBe('Для проверки подтвердите размеры')
  })
})
