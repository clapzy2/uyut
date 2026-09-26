import { describe, expect, it } from 'vitest'
import { resolveShoppingVariant } from './variant'

const green = {
  color: 'зелёный велюр',
  priceKopecks: 7_990_000,
  affiliateUrl: 'https://shop.example/green',
  imageUrl: 'https://cdn.example/green.jpg',
}

describe('authoritative shopping variants', () => {
  it('keeps the base product when no variant was selected', () => {
    expect(resolveShoppingVariant(null, [green])).toBeNull()
    expect(resolveShoppingVariant({}, null)).toBeNull()
  })

  it('takes current price and original photo from the store, not the browser', () => {
    expect(
      resolveShoppingVariant(
        { ...green, priceKopecks: 1, imageUrl: 'https://untrusted.example/image' },
        [green],
      ),
    ).toEqual(green)
  })

  it('rejects unknown colors, links and ambiguous variants', () => {
    expect(() => resolveShoppingVariant({ color: 'красный' }, [green])).toThrow()
    expect(() =>
      resolveShoppingVariant({ ...green, affiliateUrl: 'https://untrusted.example' }, [green]),
    ).toThrow()
    expect(() => resolveShoppingVariant(green, [green, green])).toThrow()
  })

  it('does not accept a price-only override on a product without variants', () => {
    expect(() => resolveShoppingVariant({ priceKopecks: 1 }, null)).toThrow()
  })

  it('rejects nonexistent recoloring materials', () => {
    expect(() => resolveShoppingVariant({ swatchId: 'missing-material' }, null)).toThrow()
  })

  it('keeps recoloring as a wish, without an invented store price, photo or link', () => {
    expect(resolveShoppingVariant({ ...green, swatchId: 'linen-milk' }, [green])).toEqual({
      swatchId: 'linen-milk',
      color: 'молочный лён',
    })
  })
})
