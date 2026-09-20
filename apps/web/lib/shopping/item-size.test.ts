import type { DimensionsCm } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { effectiveSize, effectiveSizeReading, itemSizeSourceLabel } from './item-size'

const product = (dimensionsCm?: DimensionsCm) => ({
  attributes: dimensionsCm ? { dimensionsCm } : null,
})

describe('effectiveSize', () => {
  it('вписанное человеком главнее карточки магазина', () => {
    const size = effectiveSize(
      { dimensionsCm: { width: 220, depth: 95 } },
      product({ width: 180, depth: 80, height: 70 }),
    )
    expect(size).toEqual({ width: 220, depth: 95 })
  })

  it('без вписанного берём карточку', () => {
    expect(effectiveSize({ dimensionsCm: null }, product({ width: 180 }))).toEqual({ width: 180 })
  })

  it('пустая запись человека карточку не отменяет', () => {
    expect(effectiveSize({ dimensionsCm: {} }, product({ width: 180 }))).toEqual({ width: 180 })
  })

  it('когда нет ни того, ни другого — нет и размеров', () => {
    expect(effectiveSize({ dimensionsCm: null }, product())).toBeNull()
  })

  it('показывает человеку происхождение и доверие к размеру', () => {
    expect(
      effectiveSizeReading(
        { dimensionsCm: null },
        {
          attributes: {
            dimensionsCm: { width: 180, depth: 80 },
            dimensionsSource: { width: 'store-parameters', depth: 'store-parameters' },
          },
        },
      ),
    ).toEqual({
      dimensionsCm: { width: 180, depth: 80 },
      source: 'store-parameters',
      confidence: 'reported',
    })
    expect(
      itemSizeSourceLabel({
        dimensionsCm: { width: 180 },
        source: 'store-text',
        confidence: 'parsed',
      }),
    ).toContain('проверьте')
  })

  it('понижает доверие, если хотя бы одна сторона извлечена из текста', () => {
    const reading = effectiveSizeReading(
      { dimensionsCm: null },
      {
        attributes: {
          dimensionsCm: { width: 180, depth: 80 },
          dimensionsSource: { width: 'store-parameters', depth: 'store-text' },
        },
      },
    )
    expect(reading.source).toBe('store-text')
    expect(reading.confidence).toBe('parsed')
  })
})
