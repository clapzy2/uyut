import type { DimensionsCm } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { effectiveSize } from './item-size'

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
})
