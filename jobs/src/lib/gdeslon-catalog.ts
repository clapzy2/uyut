// Единый сбор и нормализация Gdeslon для ручного CSV и ночного обновления.
import { createHash } from 'node:crypto'
import {
  categoryFromText,
  type FeedItem,
  type GdeslonOffer,
  parseCsvDump,
  parseGdeslonOffers,
  parseRubles,
} from '@uyut/catalog'
import type { CatalogCategory } from '@uyut/db'

const API = 'https://api.gdeslon.ru/api/search.xml'
// Выдача отвечает за треть секунды на десятке товаров и виснет на больших порциях,
// поэтому берём мелкими страницами и повторяем при обрыве.
const PER_PAGE = 10
const ATTEMPTS = 3
// Останавливаем зависшее соединение; временный сетевой обрыв допускает повтор.
const REQUEST_TIMEOUT_MS = 10_000
const PARALLEL_QUERIES = 3

type Offer = GdeslonOffer

export type GdeslonRow = {
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
export const GDESLON_QUERIES: readonly string[] = [
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

export function toRow(offer: Offer): GdeslonRow | null {
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
  // В названии «600×760×900» порядок осей не определён. Даже правдоподобная
  // высота не доказывает, где ширина и глубина. Для расстановки принимаем
  // только отдельные подписанные параметры магазина, без догадок из текста.
  const measured = offer.dimensions
  // Артикул может быть общим для разных SKU. Разделяем их по id сети;
  // без id используем ссылку, а не случайно оставляем первый пришедший вариант.
  const identity = offer.id || createHash('sha256').update(offer.url).digest('hex').slice(0, 24)
  const externalId = offer.merchantId
    ? `${offer.merchantId}-${offer.article || 'sku'}-${identity}`
    : identity
  const sourceFor = (axis: keyof typeof measured): string => {
    if (measured[axis] === undefined) return ''
    return 'store-parameters'
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

export function toCsv(rows: GdeslonRow[]): string {
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

export type GdeslonCollection = {
  rows: GdeslonRow[]
  items: FeedItem[]
  requestedPages: number
  failedPages: number
  withoutDisclosure: number
}

/** Время и объём ограничены; успешный поиск всё равно остаётся выборкой, а не полным фидом. */
export async function collectGdeslon(
  token: string,
  options: {
    pages?: number
    queries?: readonly string[]
    maxMs?: number
    fetcher?: typeof fetch
  } = {},
): Promise<GdeslonCollection> {
  const pages = options.pages ?? 3
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 12) {
    throw new Error('Число страниц должно быть целым от 1 до 12')
  }
  const fetcher = options.fetcher ?? fetch
  const deadline = Date.now() + (options.maxMs ?? 240_000)
  const queue = [...(options.queries ?? GDESLON_QUERIES)]
  const collected = new Map<string, GdeslonRow>()
  let requestedPages = 0
  let failedPages = 0
  let withoutDisclosure = 0

  async function fetchPage(query: string, page: number): Promise<Offer[] | null> {
    const url = new URL(API)
    url.search = new URLSearchParams({
      _gs_at: token,
      q: query,
      l: String(PER_PAGE),
      p: String(page),
    }).toString()
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return null
      try {
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        })
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) return null
          throw new Error('Ответ API не принят')
        }
        return parseGdeslonOffers(await response.text())
      } catch {
        // Ошибка fetch может содержать URL с ключом. Наружу возвращаем только счётчик.
        if (attempt < ATTEMPTS && deadline - Date.now() > 500) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }
    return null
  }

  async function worker(): Promise<void> {
    for (let query = queue.shift(); query; query = queue.shift()) {
      for (let page = 1; page <= pages; page += 1) {
        requestedPages += 1
        const offers = await fetchPage(query, page)
        if (offers === null) {
          failedPages += 1
          break
        }
        if (offers.length === 0) break
        for (const offer of offers) {
          const row = toRow(offer)
          if (!row || collected.has(row.externalId)) continue
          if (!row.disclosure) {
            withoutDisclosure += 1
            continue
          }
          collected.set(row.externalId, row)
        }
      }
    }
  }

  await Promise.all(Array.from({ length: PARALLEL_QUERIES }, () => worker()))
  const rows = [...collected.values()]
  const parsed = parseCsvDump(toCsv(rows), 'gdeslon')
  if (parsed.skipped.length > 0) {
    throw new Error('Нормализованная выборка не прошла проверку каталога')
  }
  return { rows, items: parsed.items, requestedPages, failedPages, withoutDisclosure }
}
