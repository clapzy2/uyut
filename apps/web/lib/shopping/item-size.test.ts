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
    expect(size).toEqual({ width: 220, depth: 95, height: 70 })
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

  it('не использует текстовые оси прежнего Gdeslon для расстановки', () => {
    for (const dimensionsSource of [undefined, { width: 'store-text' as const }]) {
      expect(
        effectiveSize(
          { dimensionsCm: null },
          {
            source: 'gdeslon',
            attributes: { dimensionsCm: { width: 60, depth: 76, height: 90 }, dimensionsSource },
          },
        ),
      ).toBeNull()
    }
  })

  it('сохраняет ручные мерки и подписанные оси Gdeslon без правки старой записи', () => {
    const legacy = {
      source: 'gdeslon' as const,
      attributes: {
        dimensionsCm: { width: 60, depth: 76, height: 90 },
        dimensionsSource: { width: 'store-parameters' as const, depth: 'store-text' as const },
      },
    }
    const before = structuredClone(legacy)
    expect(effectiveSize({ dimensionsCm: { depth: 90, height: 76 } }, legacy)).toEqual({
      width: 60,
      depth: 90,
      height: 76,
    })
    expect(effectiveSize({ dimensionsCm: null }, legacy)).toEqual({ width: 60 })
    expect(legacy).toEqual(before)
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

  it('ввод высоты сохраняет основание магазина и не подтверждает чужие мерки', () => {
    const reading = effectiveSizeReading(
      { dimensionsCm: { height: 85 } },
      {
        attributes: {
          dimensionsCm: { width: 210, depth: 90, height: 70 },
          dimensionsSource: { width: 'store-parameters', depth: 'store-parameters' },
        },
      },
    )
    expect(reading).toEqual({
      dimensionsCm: { width: 210, depth: 90, height: 85 },
      source: 'mixed',
      confidence: 'reported',
      dimensionSources: { width: 'store-parameters', depth: 'store-parameters', height: 'user' },
    })
    expect(itemSizeSourceLabel(reading)).toBe(
      'высота — введено вами; ширина, глубина — из характеристик магазина',
    )
  })

  it('смешанные мерки из описания остаются непроверенными, отсутствующая высота не возникает', () => {
    const reading = effectiveSizeReading(
      { dimensionsCm: { width: 220 } },
      product({ width: 180, depth: 80 }),
    )
    expect(reading.dimensionsCm).toEqual({ width: 220, depth: 80 })
    expect(reading.source).toBe('mixed')
    expect(reading.confidence).toBe('parsed')
    expect(itemSizeSourceLabel(reading)).toBe(
      'ширина — введено вами; глубина — из описания магазина — проверьте',
    )
  })

  it('не считает размер из магазина подтверждённым при отсутствующем источнике одной стороны', () => {
    const reading = effectiveSizeReading(
      { dimensionsCm: null },
      {
        attributes: {
          dimensionsCm: { width: 180, depth: 80 },
          dimensionsSource: { width: 'store-parameters' },
        },
      },
    )
    expect(reading.source).toBe('store-text')
    expect(reading.confidence).toBe('parsed')
  })

  it('отбрасывает неположительные и нечисловые значения без выдуманных замен', () => {
    expect(
      effectiveSize(
        { dimensionsCm: { width: Number.NaN, height: -1 } },
        product({ width: 180, depth: Number.POSITIVE_INFINITY, height: 0 }),
      ),
    ).toEqual({ width: 180 })
  })
})
