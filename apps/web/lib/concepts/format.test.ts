import type { FitVerdict } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { fitLabel } from './format'

describe('fitLabel', () => {
  it.each([
    ['itemDimensions', 'Нужны полные размеры товара'],
    ['roomDimensions', 'Нужны размеры комнаты'],
    ['wallMeasurements', 'Нужен замер свободного участка стены'],
  ] as const)('объясняет неопределённость: %s', (reason, label) => {
    expect(fitLabel({ state: 'unknown', reason })).toBe(label)
  })

  it('положительный ответ называет именно проверку размеров', () => {
    const fit: FitVerdict = {
      state: 'fits',
      itemCm: 120,
      spot: { name: 'стена слева', widthCm: 200 },
    }
    expect(fitLabel(fit)).toBe('Подходит по размерам: стена слева 200 см')
  })
})
