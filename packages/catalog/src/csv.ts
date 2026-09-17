import type { CatalogCategory, CatalogSource, CatalogVariant } from '@uyut/db'
import { categoryFromText, isCatalogCategory } from './categories'
import { hasAnyDimension, parseDimensionsCm } from './dimensions'
import { subcategoryFromText } from './subcategories'
import type { FeedItem, FeedParseResult, SkippedRow } from './types'

/**
 * Разбор CSV без зависимостей: кавычки, экранированные кавычки, переводы строк внутри поля.
 * Разделитель определяется по заголовку: Excel в русской локали сохраняет с точкой с запятой.
 */
function* csvRows(text: string): Generator<string[]> {
  const source = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(source)
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
      yield row
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    yield row
  }
}

function* parseCsvRecords(text: string): Generator<Record<string, string>> {
  const rows = csvRows(text)
  const first = rows.next()
  if (first.done) {
    return
  }
  const header = first.value
  const keys = header.map((key) => key.trim().toLowerCase())
  for (const cells of rows) {
    if (!cells.some((cell) => cell.trim() !== '')) {
      continue
    }
    yield Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()]))
  }
}

export function parseCsv(text: string): Record<string, string>[] {
  return [...parseCsvRecords(text)]
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

function parseLengthCm(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/)
  if (!match) {
    return undefined
  }
  const number = Number(match[0])
  if (!Number.isFinite(number) || number <= 0) {
    return undefined
  }
  const cm = /(?:^|\s)(?:мм|mm)(?:\s|$)/i.test(value) || number > 400 ? number / 10 : number
  const rounded = Math.round(cm)
  return rounded >= 15 && rounded <= 400 ? rounded : undefined
}

function parseAdmitadParams(value: string | undefined): Map<string, string> {
  const params = new Map<string, string>()
  for (const part of value?.split('|') ?? []) {
    const separator = part.indexOf(':')
    if (separator < 1) {
      continue
    }
    const name = part.slice(0, separator).trim().toLowerCase()
    const contents = part.slice(separator + 1).trim()
    if (name && contents && !params.has(name)) {
      params.set(name, contents)
    }
  }
  return params
}

function firstParam(params: Map<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = params.get(name.toLowerCase())
    if (value) {
      return value
    }
  }
  return undefined
}

const ADMITAD_NON_FURNITURE =
  /матрас|подуш|наматрас|топпер|одеял|плед|постельн|простын|наволоч|пододеяль|чехол|защитн(?:ый|ая) слой|основани[ея] для кроват|реш[её]тк|трансформируемое основание|аксессуар/i

const ADMITAD_FURNITURE_TITLE =
  /^(?:кровать|диван|софа|кушетка|кресло|стул|табурет|банкетка|пуф|тумба|комод|шкаф|стеллаж|стол|зеркало)\b/i

function isAdmitadFurniture(row: Record<string, string>): boolean {
  if (ADMITAD_FURNITURE_TITLE.test(row.name ?? '')) {
    return true
  }
  return !ADMITAD_NON_FURNITURE.test(
    [row.categoryid, row.type, row.typeprefix, row.name].filter(Boolean).join(' · '),
  )
}

function admitadDimensions(
  category: CatalogCategory,
  params: Map<string, string>,
  fallbackText: string,
): { width?: number; depth?: number; height?: number } {
  const width = parseLengthCm(firstParam(params, 'ширина', 'ширина, см'))
  const depth = parseLengthCm(firstParam(params, 'глубина', 'длина', 'длина, см'))
  const height = parseLengthCm(
    firstParam(params, 'высота', 'высота, см', 'высота изголовья', 'высота кровати'),
  )
  const named = { width, depth, height }
  if (hasAnyDimension(named)) {
    return named
  }

  const combined = firstParam(params, 'габаритные размеры', 'габариты', 'размеры товара', 'размеры')
  const parsed = parseDimensionsCm(`${combined ?? ''} ${fallbackText}`, {
    sleepingIsFootprint: category === 'bed',
  })
  // Askona записывает габариты кроватей как Д×Ш×В, а наш движок хранит Ш×Г×В.
  if (category === 'bed' && combined && parsed.width && parsed.depth) {
    return { width: parsed.depth, depth: parsed.width, height: parsed.height }
  }
  return parsed
}

function canonicalAdmitadId(row: Record<string, string>): string {
  try {
    const affiliate = new URL(row.url as string)
    const destinationValue = affiliate.searchParams.get('ulp')
    if (!destinationValue) {
      return row.id as string
    }
    let destination: URL
    try {
      destination = new URL(destinationValue)
    } catch {
      destination = new URL(decodeURIComponent(destinationValue))
    }
    for (const key of [...destination.searchParams.keys()]) {
      if (/fabric|color|цвет|ткан/i.test(key)) {
        destination.searchParams.delete(key)
      }
    }
    destination.searchParams.sort()
    return `${destination.hostname}${destination.pathname}${destination.search}`
  } catch {
    return row.id as string
  }
}

/**
 * Универсальный CSV-экспорт Admitad Store. У Askona одна модель повторяется для каждой ткани;
 * такие строки объединяются в один товар с вариантами, иначе каталог разрастается в десятки раз.
 */
export function parseAdmitadCsv(text: string, source: CatalogSource): FeedParseResult {
  const itemsById = new Map<string, FeedItem>()
  const skipped: SkippedRow[] = []
  for (const row of parseCsvRecords(text)) {
    const rowId = row.id
    const title = row.name
    if (!rowId || !title) {
      skipped.push({ reason: 'нет id или name', externalId: rowId, title })
      continue
    }
    if (!parseBoolean(row.available)) {
      skipped.push({ reason: 'нет в наличии', externalId: rowId, title })
      continue
    }
    if (!isAdmitadFurniture(row)) {
      skipped.push({ reason: 'не мебель', externalId: rowId, title })
      continue
    }
    // Название и тип точнее общего пути: в Askona пуфы лежат в разделе «Диваны/Пуфы».
    const category =
      categoryFromText(title, row.type, row.typeprefix) ?? categoryFromText(row.categoryid)
    if (!category) {
      skipped.push({ reason: 'неизвестная категория', externalId: rowId, title })
      continue
    }
    const priceKopecks = parseRubles(row.price)
    const picture = row.picture
      ?.split(/[|,]/)
      .map((value) => value.trim())
      .find(Boolean)
    if (!priceKopecks) {
      skipped.push({ reason: 'нет цены', externalId: rowId, title })
      continue
    }
    if (!row.url || !picture) {
      skipped.push({ reason: 'нет ссылки или картинки', externalId: rowId, title })
      continue
    }
    if (row.currencyid && row.currencyid.toUpperCase() !== 'RUB') {
      skipped.push({
        reason: `неподдерживаемая валюта ${row.currencyid}`,
        externalId: rowId,
        title,
      })
      continue
    }

    const params = parseAdmitadParams(row.param)
    const color = firstParam(params, 'цвет', 'цвет ткани', 'основной цвет')
    const material = firstParam(params, 'материал', 'материал обивки', 'ткань')
    const dimensions = admitadDimensions(category, params, `${title} ${row.description ?? ''}`)
    const externalId = canonicalAdmitadId(row)
    const variant: CatalogVariant = { color, priceKopecks, affiliateUrl: row.url }
    const existing = itemsById.get(externalId)
    if (existing) {
      const variants = existing.variants ?? []
      if (
        variants.length < 24 &&
        !variants.some(
          (entry) => entry.color === variant.color && entry.priceKopecks === variant.priceKopecks,
        )
      ) {
        variants.push(variant)
        existing.variants = variants
      }
      continue
    }

    itemsById.set(externalId, {
      source,
      externalId,
      category,
      subcategory: subcategoryFromText(category, title, row.type, row.categoryid),
      brand: row.vendor || undefined,
      title,
      description: row.description || undefined,
      priceKopecks,
      oldPriceKopecks: parseRubles(row.oldprice) ?? undefined,
      affiliateUrl: row.url,
      images: [{ url: picture, alt: title }],
      attributes: {
        color,
        material,
        dimensionsCm: hasAnyDimension(dimensions) ? dimensions : undefined,
      },
      variants: [variant],
      inStock: true,
    })
  }
  return { items: [...itemsById.values()], skipped }
}

/**
 * Дамп, который владелец собирает руками: одна строка на товар, колонки как в README пакета.
 * Обязательны external_id, category, title, price_rub, url, image_url.
 */
export function parseCsvDump(text: string, source: CatalogSource = 'dump'): FeedParseResult {
  const items: FeedItem[] = []
  const skipped: SkippedRow[] = []
  for (const row of parseCsvRecords(text)) {
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
    // Размеры из отдельных колонок, а если их нет — из самого названия: чаще всего они именно там
    const fromColumns = {
      width: parseNumber(row.width_cm),
      depth: parseNumber(row.depth_cm),
      height: parseNumber(row.height_cm),
    }
    const measured = hasAnyDimension(fromColumns)
      ? fromColumns
      : parseDimensionsCm(`${title} ${row.description ?? ''}`, {
          sleepingIsFootprint: category === 'bed',
        })
    const { width, depth, height } = measured
    items.push({
      source,
      externalId,
      category,
      subcategory: row.subcategory || subcategoryFromText(category, title, row.description),
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
        dimensionsCm: hasAnyDimension(measured) ? { width, depth, height } : undefined,
        adDisclosure: row.ad_disclosure || undefined,
      },
      inStock: parseBoolean(row.in_stock),
    })
  }
  return { items, skipped }
}
