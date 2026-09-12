import { isBathroomFixture, isForeignListing, isNotFurniture } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('isBathroomFixture', () => {
  it('сантехнические марки и прямые указания на ванную', () => {
    expect(isBathroomFixture('Стеллаж Allen Brau Liberty 60 1.33006.60 Медь браш')).toBe(true)
    expect(isBathroomFixture('Полка корзина Migliore Complementi 22037 Хром')).toBe(true)
    expect(isBathroomFixture('Стульчик для ванной Geralis T-W-V')).toBe(true)
    expect(isBathroomFixture('Табурет в ванную Ridder Go А170101')).toBe(true)
    expect(isBathroomFixture('Косметическое зеркало Kludi Vela R')).toBe(true)
    expect(isBathroomFixture('Полка для полотенец Boheme Imperiale 10419')).toBe(true)
  })

  it('мебель с похожими буквами остаётся', () => {
    // «Саванна» содержит «ванн», а устричные раковины — «раковин»
    expect(isBathroomFixture('Ваза - цилиндр «Саванна» для цветов, 27 см')).toBe(false)
    expect(isBathroomFixture('Ваза декоративная Glasar с отделкой раковинами устриц')).toBe(false)
    expect(isBathroomFixture('Диван угловой «Милан», еврокнижка')).toBe(false)
    expect(isBathroomFixture('Кресло мягкое «Моне», обивка ткань релакс')).toBe(false)
  })
})

describe('isForeignListing', () => {
  it('перепродажи с зарубежных площадок', () => {
    expect(isForeignListing('https://s.click.aliexpress.com/e/_abc')).toBe(true)
  })

  it('латинское название само по себе не повод выбрасывать', () => {
    // У Tkano латинские имена моделей, а её ковры — одни из лучших наших совпадений
    expect(isForeignListing('https://www.divan.ru/product/tkano-terra')).toBe(false)
    expect(
      isNotFurniture({
        title: 'Tkano Terra Tea plantation TK22-DR0008',
        affiliateUrl: 'https://divan.ru/x',
      }),
    ).toBe(false)
  })
})
