// Сбор каталога из партнёрской сети «Где Слон?»: bun run catalog:gdeslon [--out файл] [--pages N]
// Пишет CSV в том же формате, что читает catalog:import, — импорт остаётся отдельным шагом,
// чтобы результат сбора можно было посмотреть глазами до записи в базу.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  categoryFromText,
  type GdeslonOffer,
  parseDimensionsCm,
  parseGdeslonOffers,
  parseRubles,
} from '@uyut/catalog'
import type { CatalogCategory } from '@uyut/db'
import { requireEnv } from '../src/lib/env'

const API = 'https://api.gdeslon.ru/api/search.xml'
// Выдача отвечает за треть секунды на десятке товаров и виснет на больших порциях,
// поэтому берём мелкими страницами и повторяем при обрыве.
const PER_PAGE = 10
const ATTEMPTS = 3
// Останавливаем зависшее соединение; временный сетевой обрыв допускает повтор.
const REQUEST_TIMEOUT_MS = 10_000
const PARALLEL_QUERIES = 8

type Offer = GdeslonOffer

type Row = {
  externalId: string
  category: CatalogCategory
  title: string
  priceRub: number
  oldPriceRub: number | null
  url: string
  imageUrl: string
  imageUrl2: string
  brand: string
  description: string
  color: string
  width: number | null
  depth: number | null
  height: number | null
  disclosure: string
  widthSource: string
  depthSource: string
  heightSource: string
}

/** Запросы подобраны так, чтобы попадать в мебель, а не в аксессуары к ней. */
const QUERIES: string[] = [
  'диван угловой',
  'диван прямой',
  'диван-кровать',
  'софа',
  'кресло для гостиной',
  'стул обеденный',
  'пуф',
  'банкетка',
  'стол обеденный',
  'журнальный столик',
  'письменный стол',
  'стол компьютерный',
  'шкаф распашной',
  'комод',
  'стеллаж',
  'тумба под телевизор',
  'полка настенная',
  'люстра',
  'торшер',
  'настольная лампа',
  'бра настенное',
  'светильник подвесной',
  'ковер в гостиную',
  'ковер прикроватный',
  'ковер в спальню',
  'ковер круглый',
  'кровать двуспальная',
  'кровать односпальная',
  'матрас',
  'ваза декоративная',
  'зеркало настенное',
  'картина на стену',
  'декоративная подушка',
  'плед',
  'кашпо',
  'настенные часы',
  'кресло-кровать',
  'шкаф-купе',
  'прикроватная тумба',
  'ночник',
  'постер на стену',
  'зеркало напольное',
  'ваза напольная',
  'кровать мягкая',
  'кровать с матрасом',
  'кровать полутороспальная',
  'кресло мягкое',
  'кресло офисное',
  'стул барный',
  'табурет',
  'ковер 160х230',
  'ковер шерстяной',
  'диван модульный',
  'диван двухместный',
  'тумба прикроватная',
  'шкаф для одежды',
  'полка книжная',
  'светильник настенный',
  'абажур',
  'зеркало в раме',
  'подсвечник',
  'статуэтка',
]

/**
 * Рулон ковролина или дорожка на отрез: цены у такого нет, есть цена за метр.
 *
 * Ищем именно слова. Числовое правило («длина в тысячах сантиметров») пробовали — оно
 * приняло за рулон обычные габариты в миллиметрах: «Кровать двуспальная, 1600×2000 мм»
 * отсеивалась вместе с тремя четвертями кроватей.
 */
const SOLD_BY_THE_METRE =
  /рулон|(?<![а-яё])рул\.|погонн|на отрез|за метр|за м2|подкладочн|ковролин/i

/**
 * Слова, по которым видно, что это не предмет обстановки, а сопутствующий товар: чехлы,
 * запчасти, лампочки, техника, кукольная мебель. Наш определитель категорий смотрит на
 * название, и «чехол на диван» он честно считает диваном, поэтому отсев нужен здесь.
 */
const NOT_FURNITURE =
  /чехол|накидк|наматрасник|еврочехол|обивочн|ремкомплект|запчаст|фурнитур|(?<![а-яё])ножк[аи](?![а-яё])|опор[аы] для|^подлокотник|подлокотник для|механизм трансформац|наклейк|фотообои|(?<![а-яё])обои(?![а-яё])|духов|холодильн|морозильн|посудомоеч|стиральн|сушильн|вытяжк|варочн|микроволнов|для кукол|кукольн|миниатюр|игрушечн|конструктор|пазл|(?<![а-яё])макет(?![а-яё])|лампочк|лампа накаливания|светодиодная лампа|лампа led|цокол|патрон|филамент|лента светодиодн|блок питания|драйвер|выключател|розетк|удлинител|коврик для мыш|коврик для ванн|коврик для йог|коврик придверн|автоковр|в багажник|багажник|в салон автомобил|под умывальник|для ванной комнаты|под раковин|для кошек|для собак|для животных|лежанк|когтеточ|столов[ыа][ея] прибор|^столешниц|столешница для|подстолье|бильярдн|теннисн|верстак|уценк|б\/у/i

/** Разумные границы цены в рублях: снизу отсекают аксессуары, сверху — витрины и опечатки. */
const PRICE_RANGE: Record<CatalogCategory, [number, number]> = {
  sofa: [8_000, 400_000],
  bed: [5_000, 400_000],
  chair: [1_500, 150_000],
  table: [2_000, 200_000],
  storage: [2_000, 300_000],
  lamp: [700, 150_000],
  rug: [900, 200_000],
  decor: [200, 60_000],
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

/** Пустой массив — страниц больше нет, null — запрос не удался и страницу стоит пропустить. */
async function fetchPage(token: string, query: string, page: number): Promise<Offer[] | null> {
  const url = `${API}?_gs_at=${token}&q=${encodeURIComponent(query)}&l=${PER_PAGE}&p=${page}`
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!response.ok) {
        throw new Error(`${response.status}`)
      }
      return parseGdeslonOffers(await response.text())
    } catch (error) {
      if (attempt >= ATTEMPTS) {
        const reason = error instanceof Error ? error.name : 'ошибка запроса'
        console.log(`  «${query}» страница ${page}: ${reason}`)
        failedPages += 1
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
}

/**
 * Цвет из «..., цвет коричневый». Второе слово берётся только со строчной буквы: без этого
 * в цвет попадало начало следующего предложения — «коричневый Диван угловой».
 */
function colorOf(text: string): string {
  const match = /[Цц]вет[а-я]*[:\s—-]+([А-ЯЁа-яё][а-яё]*(?:[-\s][а-яё]+)?)/.exec(text)
  const color = match?.[1]?.trim().toLowerCase() ?? ''
  return color.length <= 25 ? color : ''
}

function shopOf(url: string): string {
  const goto = /goto=([^&]+)/.exec(url)?.[1]
  if (!goto) {
    return ''
  }
  try {
    return new URL(decodeURIComponent(goto)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function toRow(offer: Offer): Row | null {
  if (offer.currency && !['RUR', 'RUB'].includes(offer.currency.toUpperCase())) {
    return null
  }
  if (!offer.available || !offer.picture.startsWith('http') || !offer.url || !offer.title) {
    return null
  }
  if (NOT_FURNITURE.test(offer.title) || SOLD_BY_THE_METRE.test(offer.title)) {
    return null
  }
  const category = categoryFromText(offer.title)
  if (!category) {
    return null
  }
  const priceKopecks = parseRubles(offer.price)
  if (priceKopecks === null) return null
  const price = priceKopecks / 100
  const [floor, ceiling] = PRICE_RANGE[category]
  if (!Number.isFinite(price) || price < floor || price > ceiling) {
    return null
  }
  const oldPriceKopecks = parseRubles(offer.oldPrice)
  const oldPrice = oldPriceKopecks === null ? null : oldPriceKopecks / 100
  const dimensionsText = `${offer.title} ${offer.description}`
  const parsedDimensions = parseDimensionsCm(dimensionsText)
  // Пара размеров в названии кровати часто означает матрас. При отсутствии
  // высоты и явного указания внешнего габарита оставляем размер неизвестным.
  const extracted =
    category === 'bed' &&
    parsedDimensions.height === undefined &&
    !/габарит|внешн(?:ие|ий|яя|их)/i.test(dimensionsText)
      ? {}
      : parsedDimensions
  const measured = {
    width: offer.dimensions.width ?? extracted.width,
    depth: offer.dimensions.depth ?? extracted.depth,
    height: offer.dimensions.height ?? extracted.height,
  }
  // Артикул может быть общим для разных SKU. Разделяем их по id сети;
  // без id используем ссылку, а не случайно оставляем первый пришедший вариант.
  const identity = offer.id || createHash('sha256').update(offer.url).digest('hex').slice(0, 24)
  const externalId = offer.merchantId
    ? `${offer.merchantId}-${offer.article || 'sku'}-${identity}`
    : identity
  const sourceFor = (axis: keyof typeof measured): string => {
    if (measured[axis] === undefined) return ''
    return offer.dimensions[axis] !== undefined ? 'store-parameters' : 'store-text'
  }
  return {
    externalId,
    category,
    title: offer.title.slice(0, 200),
    priceRub: price,
    oldPriceRub: oldPrice !== null && oldPrice > price ? oldPrice : null,
    url: offer.url,
    imageUrl: offer.picture,
    imageUrl2: offer.extraPicture,
    // Производитель в фиде часто пустой или прочерк: тогда показываем магазин
    brand: offer.vendor.length > 1 ? offer.vendor : shopOf(offer.url),
    description: offer.description.slice(0, 600),
    color: offer.color || colorOf(`${offer.title} ${offer.description}`),
    width: measured.width ?? null,
    depth: measured.depth ?? null,
    height: measured.height ?? null,
    disclosure: offer.disclosure,
    widthSource: sourceFor('width'),
    depthSource: sourceFor('depth'),
    heightSource: sourceFor('height'),
  }
}

const COLUMNS = [
  'external_id',
  'category',
  'title',
  'price_rub',
  'url',
  'image_url',
  'image_url_2',
  'brand',
  'description',
  'old_price_rub',
  'color',
  'width_cm',
  'depth_cm',
  'height_cm',
  'ad_disclosure',
  'width_source',
  'depth_source',
  'height_source',
  'dimensions_checked',
] as const

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Row[]): string {
  const lines = [COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.externalId,
        row.category,
        row.title,
        row.priceRub,
        row.url,
        row.imageUrl,
        row.imageUrl2,
        row.brand,
        row.description,
        row.oldPriceRub,
        row.color,
        row.width,
        row.depth,
        row.height,
        row.disclosure,
        row.widthSource,
        row.depthSource,
        row.heightSource,
        'true',
      ]
        .map(cell)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

let failedPages = 0

async function main(): Promise<void> {
  const token = requireEnv('GDESLON_TOKEN')
  const out = argValue('out', 'gdeslon.csv')
  const pages = Number(argValue('pages', '12'))
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new Error('Число страниц должно быть положительным целым числом')
  }

  const collected = new Map<string, Row>()
  const queue = [...QUERIES]

  async function worker(): Promise<void> {
    for (let query = queue.shift(); query; query = queue.shift()) {
      let kept = 0
      for (let page = 1; page <= pages; page += 1) {
        const offers = await fetchPage(token, query, page)
        if (offers === null) {
          // Обрыв на одной странице не повод бросать запрос: идём к следующей
          continue
        }
        if (offers.length === 0) {
          break
        }
        for (const offer of offers) {
          const row = toRow(offer)
          if (row && !collected.has(row.externalId)) {
            collected.set(row.externalId, row)
            kept += 1
          }
        }
      }
      console.log(`«${query}»: ${kept} товаров`)
    }
  }

  await Promise.all(Array.from({ length: PARALLEL_QUERIES }, () => worker()))

  const rows = [...collected.values()]
  const byCategory = new Map<string, number>()
  for (const row of rows) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1)
  }
  writeFileSync(out, toCsv(rows), 'utf8')
  console.log(`\nсобрано ${rows.length} товаров -> ${out}`)
  for (const [category, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category.padEnd(9)} ${count}`)
  }

  if (failedPages > 0) {
    console.error(
      `Сбор неполный: не удалось получить ${failedPages} страниц. Не считать файл полной свежей выгрузкой.`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
