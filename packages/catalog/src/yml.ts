import type { CatalogSource } from '@uyut/db'
import { XMLParser } from 'fast-xml-parser'
import { categoryFromText } from './categories'
import { subcategoryFromText } from './subcategories'
import type { FeedItem, FeedParseResult, SkippedRow } from './types'

type YmlCategory = { '@_id'?: string; '@_parentId'?: string; '#text'?: string }
type YmlParam = { '@_name'?: string; '#text'?: string }
type YmlOffer = {
  '@_id'?: string
  '@_available'?: string | boolean
  url?: string
  price?: string | number
  oldprice?: string | number
  currencyId?: string
  categoryId?: string | number
  picture?: string | string[]
  name?: string
  model?: string
  vendor?: string
  description?: string
  param?: YmlParam | YmlParam[]
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return text((value as Record<string, unknown>)['#text'])
  }
  const result = String(value).trim()
  return result === '' ? undefined : result
}

function kopecks(value: string | number | undefined): number | null {
  if (value === undefined) {
    return null
  }
  const number = Number(String(value).replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null
}

/**
 * YML — формат Яндекс.Маркета, в нём же отдают фиды Admitad. Категория товара восстанавливается
 * по цепочке категорий фида плюс названию, потому что деревья у магазинов разные.
 */
export function parseYml(xml: string, source: CatalogSource): FeedParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    trimValues: true,
  })
  const parsed = parser.parse(xml) as {
    yml_catalog?: {
      shop?: {
        categories?: { category?: YmlCategory | YmlCategory[] }
        offers?: { offer?: YmlOffer | YmlOffer[] }
      }
    }
  }
  const shop = parsed.yml_catalog?.shop
  const categories = new Map<string, { name: string; parentId?: string }>()
  for (const category of asArray(shop?.categories?.category)) {
    const id = category['@_id']
    const name = text(category) ?? text(category['#text'])
    if (id && name) {
      categories.set(String(id), { name, parentId: category['@_parentId'] })
    }
  }
  function categoryPath(id: string | number | undefined): string {
    const chain: string[] = []
    let current = id === undefined ? undefined : String(id)
    let guard = 0
    while (current && guard < 10) {
      const node = categories.get(current)
      if (!node) {
        break
      }
      chain.unshift(node.name)
      current = node.parentId
      guard += 1
    }
    return chain.join(' / ')
  }

  const items: FeedItem[] = []
  const skipped: SkippedRow[] = []
  for (const offer of asArray(shop?.offers?.offer)) {
    const externalId = offer['@_id']
    const title = text(offer.name) ?? text(offer.model)
    if (!externalId || !title) {
      skipped.push({ reason: 'нет id или названия', externalId })
      continue
    }
    const path = categoryPath(offer.categoryId)
    const category = categoryFromText(path, title)
    if (!category) {
      skipped.push({ reason: `не мебель: ${path || 'без категории'}`, externalId, title })
      continue
    }
    const priceKopecks = kopecks(offer.price)
    const url = text(offer.url)
    const pictures = asArray(offer.picture)
      .map(text)
      .filter((value): value is string => Boolean(value))
    if (!priceKopecks || !url || pictures.length === 0) {
      skipped.push({ reason: 'нет цены, ссылки или картинки', externalId, title })
      continue
    }
    const params = new Map<string, string>()
    for (const param of asArray(offer.param)) {
      const name = param['@_name']?.toLowerCase()
      const value = text(param)
      if (name && value) {
        params.set(name, value)
      }
    }
    const dimension = (key: string) => {
      const value = params.get(key)
      const number = value ? Number(value.replace(',', '.')) : Number.NaN
      return Number.isFinite(number) && number > 0 ? number : undefined
    }
    const width = dimension('ширина') ?? dimension('ширина, см')
    const depth = dimension('глубина') ?? dimension('глубина, см')
    const height = dimension('высота') ?? dimension('высота, см')
    const available = offer['@_available']
    items.push({
      source,
      externalId: String(externalId),
      category,
      subcategory: subcategoryFromText(category, title, path),
      brand: text(offer.vendor),
      title,
      description: text(offer.description),
      priceKopecks,
      oldPriceKopecks: kopecks(offer.oldprice) ?? undefined,
      affiliateUrl: url,
      images: pictures.map((picture) => ({ url: picture, alt: title })),
      attributes: {
        color: params.get('цвет'),
        material: params.get('материал') ?? params.get('материал обивки'),
        dimensionsCm: width || depth || height ? { width, depth, height } : undefined,
      },
      inStock: available === undefined ? true : String(available) !== 'false',
    })
  }
  return { items, skipped }
}
