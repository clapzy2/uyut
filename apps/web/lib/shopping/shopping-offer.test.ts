import { sameShoppingVariant, shoppingOffer } from '@uyut/catalog/shopping-offer'
import { describe, expect, it } from 'vitest'

const selected = {
  color: 'зелёная ткань',
  priceKopecks: 800_000,
  affiliateUrl: 'https://shop.example/green',
  imageUrl: 'https://cdn.example/old.png',
}
const product = { priceKopecks: 700_000, variants: [selected], lastSyncedAt: new Date() }

describe('current shopping offer', () => {
  it('reads the base product without substituting a store variant', () => {
    expect(shoppingOffer(product, null)).toEqual({
      variant: null,
      priceKopecks: 700_000,
      catalogNotice: null,
    })
  })

  it('reads updated prices and photos without modifying the saved selection', () => {
    const updated = { ...selected, priceKopecks: 900_000, imageUrl: 'https://cdn.example/new.png' }
    const offer = shoppingOffer({ ...product, variants: [updated] }, selected)
    expect(offer.variant).toEqual(updated)
    expect(offer.priceKopecks).toBe(900_000)
    expect(offer.catalogNotice).toContain('обновлена')
    expect(selected.priceKopecks).toBe(800_000)
  })

  it('keeps a missing variant and explicitly labels its saved price', () => {
    const offer = shoppingOffer({ ...product, variants: null, lastSyncedAt: new Date(0) }, selected)
    expect(offer.variant).toEqual(selected)
    expect(offer.priceKopecks).toBe(800_000)
    expect(offer.catalogNotice).toContain('последняя сохранённая цена')
    expect(offer.catalogNotice).toContain('48 часов')
  })

  it('does not arbitrarily select from ambiguous matches', () => {
    const changed = { ...selected, priceKopecks: 900_000 }
    const offer = shoppingOffer({ ...product, variants: [selected, changed] }, selected)
    expect(offer.priceKopecks).toBe(800_000)
    expect(offer.catalogNotice).toContain('не подтверждён')
  })

  it('never calls a base price the saved variant price when no variant price exists', () => {
    const { priceKopecks: _price, ...unpriced } = selected
    for (const variants of [null, [unpriced]]) {
      const offer = shoppingOffer({ ...product, variants }, unpriced)
      expect(offer.priceKopecks).toBe(700_000)
      expect(offer.catalogNotice).toContain('базовая цена')
      expect(offer.catalogNotice).not.toContain('последняя сохранённая')
    }
  })

  it('does not treat a changed link as the same store offer', () => {
    const changed = {
      ...selected,
      affiliateUrl: 'https://shop.example/another',
      priceKopecks: 900_000,
    }
    expect(shoppingOffer({ ...product, variants: [changed] }, selected).priceKopecks).toBe(800_000)
    expect(sameShoppingVariant(selected, changed)).toBe(false)
  })

  it('ignores store-like price and URL on a recoloring wish', () => {
    expect(shoppingOffer(product, { ...selected, swatchId: 'linen-milk' })).toMatchObject({
      priceKopecks: 700_000,
      variant: { color: selected.color, swatchId: 'linen-milk' },
    })
    expect(
      shoppingOffer(product, { ...selected, swatchId: 'linen-milk' }).variant?.affiliateUrl,
    ).toBeUndefined()
  })

  it('compares identity rather than mutable price/photo and keeps wishes separate', () => {
    expect(sameShoppingVariant(selected, { ...selected, priceKopecks: 900_000 })).toBe(true)
    expect(sameShoppingVariant(selected, null)).toBe(false)
    expect(sameShoppingVariant(null, null)).toBe(true)
    expect(sameShoppingVariant({ ...selected, swatchId: 'linen-milk' }, selected)).toBe(false)
    expect(
      sameShoppingVariant(
        { swatchId: 'linen-milk' },
        { swatchId: 'linen-milk', color: 'пожелание' },
      ),
    ).toBe(true)
  })
})
