import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { DimensionsCm } from './dimensions'
import { storeParameterDimensions } from './yml'

export type GdeslonOffer = {
  merchantId: string
  article: string
  id: string
  available: boolean
  price: string
  oldPrice: string
  currency: string
  picture: string
  extraPicture: string
  title: string
  description: string
  vendor: string
  url: string
  disclosure: string
  color: string
  dimensions: DimensionsCm
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') {
    return text((value as Record<string, unknown>)['#text'])
  }
  return String(value).trim()
}

function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function normalizedUnit(unit: string): string {
  return unit.toLowerCase().replace('мм', 'mm').replace('см', 'cm')
}

/** Ответ поиска ограничен страницей; XML-парсер сохраняет CDATA, атрибуты и сущности. */
export function parseGdeslonOffers(xml: string): GdeslonOffer[] {
  if (XMLValidator.validate(xml) !== true) {
    throw new Error('Ответ каталога содержит неполный или некорректный XML')
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    htmlEntities: true,
    trimValues: true,
  })
  const document = parser.parse(xml) as {
    offer?: unknown
    offers?: { offer?: unknown }
    yml_catalog?: { offers?: { offer?: unknown }; shop?: { offers?: { offer?: unknown } } }
  }
  if (!('yml_catalog' in document || 'offers' in document || 'offer' in document)) {
    throw new Error('Ответ API не содержит каталог товаров')
  }
  const offers =
    document.yml_catalog?.offers?.offer ??
    document.yml_catalog?.shop?.offers?.offer ??
    document.offers?.offer ??
    document.offer
  return array(offers).map((raw) => {
    const offer = raw as Record<string, unknown>
    const params = new Map<string, string>()
    for (const raw of array(offer.param)) {
      if (!raw || typeof raw !== 'object') continue
      const param = raw as Record<string, unknown>
      const name = text(param['@_name'])
      if (!name) continue
      const value = text(param)
      const unit = text(param['@_unit']).toLowerCase()
      // В YML единица может находиться в атрибуте отдельно от значения.
      // Без неё глубина 450 мм ошибочно проходит как 450 см.
      const axis =
        /^(?:ширина|глубина|высота|width|depth|height)[\s.,:;([{_-]*(мм|см|mm|cm)?[\s)\]}]*$/i.exec(
          name,
        )
      if (unit && axis) {
        if (!/^(?:мм|см|mm|cm)$/.test(unit)) continue
        const scalar = /^(\d+(?:[.,]\d+)?)\s*(мм|см|mm|cm)?$/i.exec(value)
        if (!scalar) continue
        if (
          [axis[1], scalar[2]].some(
            (label) => label && normalizedUnit(label) !== normalizedUnit(unit),
          )
        )
          continue
        params.set(name, `${scalar[1]} ${unit}`)
      } else {
        params.set(name, value)
      }
    }
    const pictures = array(offer.picture).map(text).filter(Boolean)
    const advertising = offer.tagging_ads as Record<string, unknown> | undefined
    return {
      merchantId: text(offer['@_merchant_id']) || text(offer.merchant_id),
      article: text(offer['@_article']) || text(offer.article),
      id: text(offer['@_id']),
      available: text(offer['@_available']) !== 'false',
      price: text(offer.price),
      oldPrice: text(offer.oldprice),
      currency: text(offer.currencyId),
      picture: pictures[0] ?? '',
      extraPicture: pictures[1] ?? text(offer.original_picture),
      title: text(offer.name),
      description: text(offer.description),
      vendor: text(offer.vendor),
      url: text(offer.url),
      disclosure: text(advertising?.info) || text(offer.info) || text(offer.ad_disclosure),
      color: [...params].find(([name]) => name.toLowerCase().trim() === 'цвет')?.[1] ?? '',
      dimensions: storeParameterDimensions(params),
    }
  })
}
