import type { CatalogSource } from '@uyut/db'
import { categoryFromText, isCatalogCategory } from './categories'
import type { FeedItem, FeedParseResult, SkippedRow } from './types'

/**
 * Разбор CSV без зависимостей: кавычки, экранированные кавычки, переводы строк внутри поля.
 * Разделитель определяется по заголовку: Excel в русской локали сохраняет с точкой с запятой.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const source = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(source)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1
      }
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows
  if (!header) {
    return []
  }
  const keys = header.map((key) => key.trim().toLowerCase())
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) =>
      Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()])),
    )
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const semicolons = (firstLine.match(/;/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

export function parseRubles(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const normalized = value.replace(/[\s ₽руб.]/gi, '').replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return true
  }
  return !/^(нет|no|false|0)$/i.test(value.trim())
}

/**
 * Дамп, который владелец собирает руками: одна строка на товар, колонки как в README пакета.
 * Обязательны external_id, category, title, price_rub, url, image_url.
 */
export function parseCsvDump(text: string, source: CatalogSource = 'dump'): FeedParseResult {
  const items: FeedItem[] = []
  const skipped: SkippedRow[] = []
  for (const row of parseCsv(text)) {
    const externalId = row.external_id
    const title = row.title
    if (!externalId || !title) {
      skipped.push({ reason: 'нет external_id или title', externalId, title })
      continue
    }
    const explicit = row.category?.toLowerCase()
    const category =
      explicit && isCatalogCategory(explicit)
        ? explicit
        : categoryFromText(row.category, row.subcategory, title)
    if (!category) {
      skipped.push({ reason: `непонятная категория «${row.category ?? ''}»`, externalId, title })
      continue
    }
    const priceKopecks = parseRubles(row.price_rub)
    if (!priceKopecks) {
      skipped.push({ reason: 'нет цены', externalId, title })
      continue
    }
    if (!row.url || !row.image_url) {
      skipped.push({ reason: 'нет ссылки или картинки', externalId, title })
      continue
    }
    const images = [row.image_url, row.image_url_2, row.image_url_3]
      .filter((url): url is string => Boolean(url))
      .map((url) => ({ url, alt: title }))
    const width = parseNumber(row.width_cm)
    const depth = parseNumber(row.depth_cm)
    const height = parseNumber(row.height_cm)
    items.push({
      source,
      externalId,
      category,
      subcategory: row.subcategory || undefined,
      brand: row.brand || undefined,
      title,
      description: row.description || undefined,
      priceKopecks,
      oldPriceKopecks: parseRubles(row.old_price_rub) ?? undefined,
      affiliateUrl: row.url,
      images,
      attributes: {
        color: row.color || undefined,
        material: row.material || undefined,
        dimensionsCm: width || depth || height ? { width, depth, height } : undefined,
        adDisclosure: row.ad_disclosure || undefined,
      },
      inStock: parseBoolean(row.in_stock),
    })
  }
  return { items, skipped }
}
