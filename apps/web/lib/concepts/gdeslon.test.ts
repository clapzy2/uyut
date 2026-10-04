import { checkFit, parseCsvDump, parseGdeslonOffers } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { toCsv, toRow } from '../../../../jobs/scripts/fetch-gdeslon'

function offer(body: string, attributes = 'id="sku-1" article="model-1"') {
  return `<offer ${attributes} available="true">
    <merchant_id>42</merchant_id><currencyId>RUB</currencyId>
    <name>Диван Осло</name><price>49990.45</price><oldprice>59990.99</oldprice>
    <url><![CDATA[https://shop.example/sofa?color=beige&size=220]]></url>
    <picture><![CDATA[https://cdn.example/1.jpg]]></picture>
    <picture>https://cdn.example/2.jpg</picture>${body}
  </offer>`
}

function imported(xml: string) {
  const rows = parseGdeslonOffers(xml)
    .map(toRow)
    .filter((row) => row !== null)
  return parseCsvDump(toCsv(rows), 'gdeslon').items
}

describe('Gdeslon XML → CSV → каталог', () => {
  it('сохраняет копейки, CDATA-картинки и merchant_id из отдельного тега', () => {
    const [item] = imported(offer(''))
    expect(item?.priceKopecks).toBe(4_999_045)
    expect(item?.oldPriceKopecks).toBe(5_999_099)
    expect(item?.externalId).toBe('42-model-1-sku-1')
    expect(item?.images.map((image) => image.url)).toEqual([
      'https://cdn.example/1.jpg',
      'https://cdn.example/2.jpg',
    ])
    expect(item?.affiliateUrl).toBe('https://shop.example/sofa?color=beige&size=220')
  })

  it('принимает пробел и десятичную запятую, но не цену в другой валюте', () => {
    expect(imported(offer('').replace('49990.45', '49 990,45'))[0]?.priceKopecks).toBe(4_999_045)
    expect(imported(offer('').replace('<currencyId>RUB', '<currencyId>USD'))).toEqual([])
  })

  it('не сливает SKU с одним артикулом и разными размерами и ценой', () => {
    const first = offer('<param name="Ширина, см">220</param>')
    const second = offer('<param name="Ширина, см">250</param>', 'id="sku-2" article="model-1"')
      .replace('49990.45', '54990.50')
      .replace('color=beige', 'color=grey')
    const items = imported(`<offers>${first}${second}</offers>`)
    expect(new Set(items.map((item) => item.externalId)).size).toBe(2)
    expect(items.map((item) => item.priceKopecks)).toEqual([4_999_045, 5_499_050])
    expect(items.map((item) => item.attributes?.dimensionsCm?.width)).toEqual([220, 250])
    expect(items[0]?.affiliateUrl).not.toBe(items[1]?.affiliateUrl)
  })

  it('берёт подписанную ось магазина, но не достраивает остальные из текста', () => {
    const [item] = imported(
      offer(`
      <param name="Ширина мм">2205</param><param name="Цвет">бежевый</param>
      <description>Габариты 210×95,5×85 см</description>`),
    )
    expect(item?.attributes?.dimensionsCm).toEqual({ width: 220.5 })
    expect(item?.attributes?.dimensionsSource).toEqual({
      width: 'store-parameters',
    })
    expect(item?.attributes?.color).toBe('бежевый')
  })

  it('сохраняет готовую рекламную пометку с кавычками и переносом', () => {
    const disclosure = 'Реклама. ООО "Магазин", ИНН 1234567890\nerid example-123'
    const [item] = imported(offer(`<info kind="advertising"><![CDATA[${disclosure}]]></info>`))
    expect(item?.attributes?.adDisclosure).toBe(disclosure)
    expect(imported(offer(''))[0]?.attributes?.adDisclosure).toBeUndefined()
    const nested = offer(`<tagging_ads><info><![CDATA[${disclosure}]]></info></tagging_ads>`)
    expect(imported(nested)[0]?.attributes?.adDisclosure).toBe(disclosure)
  })

  it('не превращает спальное место кровати в размер внешней рамы при повторном импорте', () => {
    const xml = offer('<description>Спальное место 160×200 см</description>').replace(
      'Диван Осло',
      'Кровать Осло',
    )
    expect(imported(xml)[0]?.attributes?.dimensionsCm).toBeUndefined()
    const ambiguousTitle = offer('').replace('Диван Осло', 'Кровать Осло 1600×2000 мм')
    expect(imported(ambiguousTitle)[0]?.attributes?.dimensionsCm).toBeUndefined()
    const externalSize = offer('<description>Внешние габариты 170×215 см</description>').replace(
      'Диван Осло',
      'Кровать Осло',
    )
    expect(imported(externalSize)[0]?.attributes?.dimensionsCm).toBeUndefined()
    const namedSize = externalSize.replace(
      '</offer>',
      '<param name="Ширина, см">170</param><param name="Глубина, см">215</param></offer>',
    )
    expect(imported(namedSize)[0]?.attributes?.dimensionsCm).toEqual({ width: 170, depth: 215 })
  })

  it('не назначает осям размеры из названия при проходе XML → CSV → каталог', () => {
    for (const title of [
      'Стол обеденный Оптима, 600×760×900 мм',
      'Стол обеденный Оптима, 90×60×76 см',
      'Диван Осло 210×95×85 см',
    ]) {
      const xml = offer('').replace('Диван Осло', title)
      expect(imported(xml)[0]?.attributes?.dimensionsCm).toBeUndefined()
      expect(imported(xml)[0]?.attributes?.dimensionsSource).toBeUndefined()
      expect(
        checkFit(imported(xml)[0]?.attributes?.dimensionsCm, {
          spots: [{ name: 'Простенок', widthCm: 85 }],
        }),
      ).toMatchObject({ state: 'unknown', reason: 'itemDimensions' })
    }
  })

  it('не переставляет подписанные параметры по величине чисел', () => {
    const xml = offer(`
      <param name="Глубина, мм">600</param>
      <param name="Высота, мм">760</param>
      <param name="Ширина, мм">900</param>`).replace('Диван Осло', 'Стол обеденный Оптима')
    const [item] = imported(xml)
    expect(item?.attributes?.dimensionsCm).toEqual({ width: 90, depth: 60, height: 76 })
    expect(item?.attributes?.dimensionsSource).toEqual({
      width: 'store-parameters',
      depth: 'store-parameters',
      height: 'store-parameters',
    })
  })

  it('понимает XML-сущности и не добавляет сетевых побочных действий при импорте модуля', () => {
    const [parsed] = parseGdeslonOffers(
      offer('<info>Реклама. &#1054;&#1054;&#1054; &quot;Магазин&quot;</info>'),
    )
    expect(parsed?.disclosure).toBe('Реклама. ООО "Магазин"')
  })

  it('отказывается от недоступного товара', () => {
    expect(imported(offer('').replace('available="true"', 'available="false"'))).toEqual([])
  })

  it('сохраняет длинный id без потери точности и отвергает обрыв XML', () => {
    const id = '18446744073709551615'
    expect(parseGdeslonOffers(offer('', `id="${id}"`))[0]?.id).toBe(id)
    expect(() => parseGdeslonOffers(offer('').slice(0, -8))).toThrow('неполный')
    expect(() => parseGdeslonOffers('<error>Нет доступа</error>')).toThrow('не содержит каталог')
  })
})
