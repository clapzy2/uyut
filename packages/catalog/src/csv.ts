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

/** Потоковый вариант для крупных партнёрских CSV: не собирает весь файл в одну строку. */
async function* csvRowsFromChunks(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let row: string[] = []
  let fieldParts: string[] = []
  let quoted = false
  let pendingQuote = false
  let skipLineFeed = false

  for await (const chunk of chunks) {
    let index = 0
    if (pendingQuote && chunk.length > 0) {
      if (chunk[0] === '"') {
        fieldParts.push('"')
        quoted = true
        index = 1
      } else {
        quoted = false
      }
      pendingQuote = false
    }

    let fieldStart = index
    for (; index < chunk.length; index += 1) {
      const char = chunk[index] as string
      if (skipLineFeed) {
        skipLineFeed = false
        if (char === '\n') {
          fieldStart = index + 1
          continue
        }
      }
      if (quoted) {
        if (char === '"') {
          fieldParts.push(chunk.slice(fieldStart, index))
          if (index + 1 < chunk.length) {
            if (chunk[index + 1] === '"') {
              fieldParts.push('"')
              index += 1
            } else {
              quoted = false
            }
          } else {
            pendingQuote = true
          }
          fieldStart = index + 1
        }
      } else if (char === '"') {
        fieldParts.push(chunk.slice(fieldStart, index))
        quoted = true
        fieldStart = index + 1
      } else if (char === ';') {
        fieldParts.push(chunk.slice(fieldStart, index))
        row.push(fieldParts.join(''))
        fieldParts = []
        fieldStart = index + 1
      } else if (char === '\n' || char === '\r') {
        if (char === '\r') {
          skipLineFeed = true
        }
        fieldParts.push(chunk.slice(fieldStart, index))
        row.push(fieldParts.join(''))
        yield row
        row = []
        fieldParts = []
        fieldStart = index + 1
      }
    }
    if (fieldStart < chunk.length) {
      fieldParts.push(chunk.slice(fieldStart))
    }
  }

  if (quoted && !pendingQuote) {
    throw new Error('CSV оборван внутри поля с кавычками')
  }
  if (fieldParts.length > 0 || row.length > 0) {
    row.push(fieldParts.join(''))
    yield row
  }
}

async function* parseCsvRecordChunks(
  chunks: AsyncIterable<string>,
): AsyncGenerator<Record<string, string>> {
  const rows = csvRowsFromChunks(chunks)
  const first = await rows.next()
  if (first.done) {
    return
  }
  const keys = first.value.map((key) => key.replace(/^﻿/, '').trim().toLowerCase())
  for await (const cells of rows) {
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
  const normalized = value
    .replace(/(?:₽|руб\.?|rub)/gi, '')
    .replace(/[\s ]/g, '')
    .replace(',', '.')
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
  const millimetres = /(?:мм|mm)(?:\s|$)/i.test(value)
  const centimetres = /(?:см|cm)(?:\s|$)/i.test(value)
  const cm = millimetres || (!centimetres && number > 400) ? number / 10 : number
  return cm >= 15 && cm <= 400 ? cm : undefined
}

function parseAdmitadLengthCm(
  value: string | undefined,
  source: CatalogSource,
): number | undefined {
  // В фиде Bestmebelshop числовые параметры без суффикса даны в миллиметрах.
  // Общая эвристика считает небольшие числа сантиметрами и ошиблась бы на глубине 400.
  if (source === 'bestmebelshop' && value && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value)) {
    return parseLengthCm(`${value} мм`)
  }
  // Divan's named outer dimensions are centimetres (verified against store cards).
  if (source === 'divan') {
    if (!value || !/^\s*\d+(?:[.,]\d+)?\s*(?:мм|см|mm|cm)?\s*$/i.test(value)) return undefined
    return parseLengthCm(/(?:мм|см|mm|cm)/i.test(value) ? value : `${value} см`)
  }
  return parseLengthCm(value)
}

function parseAdmitadParams(value: string | undefined, source: CatalogSource): Map<string, string> {
  const params = new Map<string, string>()
  for (const part of value?.split('|') ?? []) {
    const separator = source === 'divan' ? part.lastIndexOf(':') : part.indexOf(':')
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

/** Партнёрские фиды иногда передают заглушку как настоящее значение характеристики. */
function meaningfulParam(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized || /^(?:неизвестно|не указан[оа]?|нет данных|n\/?a|-)$/i.test(normalized)) {
    return undefined
  }
  return normalized
}

const ADMITAD_NON_FURNITURE =
  /матрас|подуш|наматрас|топпер|одеял|плед|постельн|простын|наволоч|пододеяль|чехол|защитн(?:ый|ая) слой|основани[ея] для кроват|реш[её]тк|трансформируемое основание|аксессуар/i

const ADMITAD_FURNITURE_TITLE =
  /^(?:кровать|диван|софа|кушетка|кресло|стул|табурет|банкетка|пуф|тумба|комод|шкаф|стеллаж|стол|зеркало)(?![а-яёa-z])/i

// Реквизиты сверены с карточкой программы Bestmebelshop RU в Admitad 05.10.2026.
// Перед включением нового фида в production их нужно сверить повторно.
const BESTMEBELSHOP_DISCLOSURE = 'Реклама. ООО «Бэст-Мебель». ИНН 3328006739'
// Verified in the connected Admitad program on 07.10.2026.
const DIVAN_DISCLOSURE = 'Реклама. ООО «Диван Трейд». ИНН 7726457128'

function hasAdmitadToken(url: string): boolean {
  try {
    return Boolean(new URL(url).searchParams.get('erid'))
  } catch {
    return false
  }
}

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
  source: CatalogSource,
): {
  dimensions: { width?: number; depth?: number; height?: number }
  source: Partial<Record<'width' | 'depth' | 'height', 'store-parameters' | 'store-text'>>
} {
  if (source === 'divan') {
    const length = parseAdmitadLengthCm(firstParam(params, 'размеры: длина габаритная'), source)
    const width = parseAdmitadLengthCm(firstParam(params, 'размеры: ширина габаритная'), source)
    const depth = parseAdmitadLengthCm(firstParam(params, 'размеры: глубина габаритная'), source)
    const height = parseAdmitadLengthCm(firstParam(params, 'размеры: высота габаритная'), source)
    // Store length spans the front of sofas/storage. Beds use width across the
    // headboard and length along the sleeping direction. Never use mattress sizes.
    const dimensions =
      category === 'bed'
        ? { width, depth: length, height }
        : { width: length, depth: depth ?? width, height }
    return {
      dimensions,
      source: Object.fromEntries(
        Object.entries(dimensions)
          .filter(([, value]) => value !== undefined)
          .map(([axis]) => [axis, 'store-parameters']),
      ),
    }
  }
  const width = parseAdmitadLengthCm(firstParam(params, 'ширина', 'ширина, см'), source)
  const depth = parseAdmitadLengthCm(firstParam(params, 'глубина', 'длина', 'длина, см'), source)
  const height = parseAdmitadLengthCm(
    firstParam(params, 'высота', 'высота, см', 'высота изголовья', 'высота кровати'),
    source,
  )
  const named = { width, depth, height }
  if (hasAnyDimension(named)) {
    return {
      dimensions: named,
      source: Object.fromEntries(
        Object.entries(named)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => [key, 'store-parameters']),
      ),
    }
  }

  const combined = firstParam(params, 'габаритные размеры', 'габариты', 'размеры товара', 'размеры')
  const parsed = parseDimensionsCm(`${combined ?? ''} ${fallbackText}`, {
    sleepingIsFootprint: category === 'bed',
  })
  // Askona записывает габариты кроватей как Д×Ш×В, а наш движок хранит Ш×Г×В.
  if (category === 'bed' && combined && parsed.width && parsed.depth) {
    return {
      dimensions: { width: parsed.depth, depth: parsed.width, height: parsed.height },
      source: { width: 'store-text', depth: 'store-text', height: 'store-text' },
    }
  }
  return {
    dimensions: parsed,
    source: Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => [key, 'store-text']),
    ),
  }
}

function canonicalAdmitadId(
  row: Record<string, string>,
  dimensions: { width?: number; depth?: number; height?: number },
  hasNamedFootprint: boolean,
): string {
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
    const hasFabric = destination.searchParams.has('SELECTED_FABRIC_ID')
    for (const key of [...destination.searchParams.keys()]) {
      if (/fabric|color|цвет|ткан/i.test(key)) {
        destination.searchParams.delete(key)
      }
    }
    // В текущем фиде Askona skuId меняется вместе с тканью. Не смешиваем размеры:
    // объединение разрешено только при известных ширине и глубине и том же productId.
    const sameSizedAskonaFabric =
      /^(?:www\.)?askona\.ru$/i.test(destination.hostname) &&
      destination.searchParams.has('productId') &&
      hasFabric &&
      hasNamedFootprint
    if (sameSizedAskonaFabric) destination.searchParams.delete('skuId')
    destination.searchParams.sort()
    const size = sameSizedAskonaFabric
      ? `|size:${dimensions.width}x${dimensions.depth}x${dimensions.height ?? '?'}`
      : ''
    return `${destination.hostname}${destination.pathname}${destination.search}${size}`
  } catch {
    return row.id as string
  }
}

/**
 * Универсальный CSV-экспорт Admitad Store. У Askona одна модель повторяется для каждой ткани;
 * такие строки объединяются в один товар с вариантами, иначе каталог разрастается в десятки раз.
 */
type AdmitadParseState = {
  source: CatalogSource
  itemsById: Map<string, FeedItem>
  skipped: SkippedRow[]
  skippedCount: number
  maxSkippedRows: number
}

function skipAdmitadRow(state: AdmitadParseState, row: SkippedRow): void {
  state.skippedCount += 1
  if (state.skipped.length < state.maxSkippedRows) {
    state.skipped.push(row)
  }
}

function addAdmitadRow(state: AdmitadParseState, row: Record<string, string>): void {
  const { itemsById, source } = state
  const rowId = row.id
  const title = row.name
  if (!rowId || !title) {
    skipAdmitadRow(state, { reason: 'нет id или name', externalId: rowId, title })
    return
  }
  if (!parseBoolean(row.available) || (source === 'divan' && !row.available)) {
    skipAdmitadRow(state, { reason: 'нет в наличии', externalId: rowId, title })
    return
  }
  const params = parseAdmitadParams(row.param, source)
  if (source === 'divan') {
    const condition = firstParam(params, 'особенности изделия')
    if (
      condition &&
      !/^без повреждений$/i.test(condition) &&
      /поврежд|скол|вмятин|царап|следы сборки|дефект|выставоч|уцен/i.test(condition)
    ) {
      skipAdmitadRow(state, { reason: 'уценённый товар с дефектом', externalId: rowId, title })
      return
    }
    if (/^(?:чистящее средство|средство для ухода|модуль для гардероба)(?![а-яё])/i.test(title)) {
      skipAdmitadRow(state, {
        reason: 'средство ухода или неполный модуль',
        externalId: rowId,
        title,
      })
      return
    }
  }
  if (!isAdmitadFurniture(row)) {
    skipAdmitadRow(state, { reason: 'не мебель', externalId: rowId, title })
    return
  }
  // Название и тип точнее общего пути: в Askona пуфы лежат в разделе «Диваны/Пуфы».
  const category =
    source === 'divan' && /^кресло[- ]кровать(?![а-яё])/i.test(title)
      ? 'chair'
      : (categoryFromText(title, row.type, row.typeprefix) ?? categoryFromText(row.categoryid))
  if (!category) {
    skipAdmitadRow(state, { reason: 'неизвестная категория', externalId: rowId, title })
    return
  }
  const priceKopecks = parseRubles(row.price)
  const picture = row.picture
    ?.split(/[|,]/)
    .map((value) => value.trim())
    .find(Boolean)
  if (!priceKopecks) {
    skipAdmitadRow(state, { reason: 'нет цены', externalId: rowId, title })
    return
  }
  if (!row.url || !picture) {
    skipAdmitadRow(state, {
      reason: 'нет ссылки или картинки',
      externalId: rowId,
      title,
    })
    return
  }
  if ((source === 'bestmebelshop' || source === 'divan') && !hasAdmitadToken(row.url)) {
    skipAdmitadRow(state, {
      reason: 'нет рекламного токена в ссылке',
      externalId: rowId,
      title,
    })
    return
  }
  const currency = row.currencyid?.toUpperCase()
  if (source === 'divan' && !currency) {
    skipAdmitadRow(state, { reason: 'не указана валюта', externalId: rowId, title })
    return
  }
  if (currency && currency !== 'RUB' && !(source === 'divan' && currency === 'RUR')) {
    skipAdmitadRow(state, {
      reason: `неподдерживаемая валюта ${row.currencyid}`,
      externalId: rowId,
      title,
    })
    return
  }

  const color = meaningfulParam(
    firstParam(
      params,
      'цвет',
      'цвет ткани',
      'основной цвет',
      ...(source === 'divan' ? ['цвет основной'] : []),
    ),
  )
  const material = meaningfulParam(firstParam(params, 'материал', 'материал обивки', 'ткань'))
  const dimensionReading = admitadDimensions(
    category,
    params,
    `${title} ${row.description ?? ''}`,
    source,
  )
  const dimensions = dimensionReading.dimensions
  const externalId =
    source === 'divan'
      ? rowId
      : canonicalAdmitadId(
          row,
          dimensions,
          dimensionReading.source.width === 'store-parameters' &&
            dimensionReading.source.depth === 'store-parameters',
        )
  const variant: CatalogVariant = {
    color,
    priceKopecks,
    affiliateUrl: row.url,
    imageUrl: picture,
  }
  const existing = itemsById.get(externalId)
  if (existing) {
    const variants = existing.variants ?? []
    if (
      variants.length < 24 &&
      !variants.some(
        (entry) =>
          entry.affiliateUrl === variant.affiliateUrl && entry.imageUrl === variant.imageUrl,
      )
    ) {
      variants.push(variant)
      existing.variants = variants
    }
    return
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
      dimensionsSource: hasAnyDimension(dimensions) ? dimensionReading.source : undefined,
      adDisclosure:
        row.ad_disclosure ||
        (source === 'bestmebelshop'
          ? BESTMEBELSHOP_DISCLOSURE
          : source === 'divan'
            ? DIVAN_DISCLOSURE
            : undefined),
    },
    variants: [variant],
    inStock: true,
  })
}

function admitadResult(state: AdmitadParseState): FeedParseResult {
  return {
    items: [...state.itemsById.values()],
    skipped: state.skipped,
    skippedCount: state.skippedCount,
  }
}

export function parseAdmitadCsv(text: string, source: CatalogSource): FeedParseResult {
  const itemsById = new Map<string, FeedItem>()
  const skipped: SkippedRow[] = []
  const state = {
    source,
    itemsById,
    skipped,
    skippedCount: 0,
    maxSkippedRows: Number.POSITIVE_INFINITY,
  }
  for (const row of parseCsvRecords(text)) {
    addAdmitadRow(state, row)
  }
  return admitadResult(state)
}

export async function parseAdmitadCsvStream(
  chunks: AsyncIterable<string>,
  source: CatalogSource,
): Promise<FeedParseResult> {
  const state: AdmitadParseState = {
    source,
    itemsById: new Map(),
    skipped: [],
    skippedCount: 0,
    maxSkippedRows: 100,
  }
  for await (const row of parseCsvRecordChunks(chunks)) {
    addAdmitadRow(state, row)
  }
  return admitadResult(state)
}

/** Ограниченные пачки для записи большого фида; одинаковые модели между пачками объединяет БД. */
export async function* admitadCsvBatches(
  chunks: AsyncIterable<string>,
  source: CatalogSource,
): AsyncGenerator<FeedParseResult> {
  const newState = (): AdmitadParseState => ({
    source,
    itemsById: new Map(),
    skipped: [],
    skippedCount: 0,
    maxSkippedRows: 100,
  })
  let state = newState()
  let rows = 0
  for await (const row of parseCsvRecordChunks(chunks)) {
    addAdmitadRow(state, row)
    rows += 1
    if (rows === 200) {
      yield admitadResult(state)
      state = newState()
      rows = 0
    }
  }
  if (rows > 0) yield admitadResult(state)
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
      skipped.push({
        reason: `непонятная категория «${row.category ?? ''}»`,
        externalId,
        title,
      })
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
    const measured =
      hasAnyDimension(fromColumns) || row.dimensions_checked === 'true'
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
        dimensionsSource: hasAnyDimension(measured)
          ? Object.fromEntries(
              Object.entries(measured)
                .filter(([, value]) => value !== undefined)
                .map(([key]) => [
                  key,
                  fromColumns[key as keyof typeof fromColumns] !== undefined
                    ? row[`${key}_source`] === 'store-text'
                      ? 'store-text'
                      : 'store-parameters'
                    : 'store-text',
                ]),
            )
          : undefined,
        adDisclosure: row.ad_disclosure || undefined,
      },
      inStock: parseBoolean(row.in_stock),
    })
  }
  return { items, skipped }
}
