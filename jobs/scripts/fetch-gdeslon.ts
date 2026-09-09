// Сбор каталога из партнёрской сети «Где Слон?»: bun run catalog:gdeslon [--out файл] [--pages N]
// Пишет CSV в том же формате, что читает catalog:import, — импорт остаётся отдельным шагом,
// чтобы результат сбора можно было посмотреть глазами до записи в базу.
import { writeFileSync } from 'node:fs'
import { categoryFromText } from '@uyut/catalog'
import type { CatalogCategory } from '@uyut/db'
import { requireEnv } from '../src/lib/env'

const API = 'https://api.gdeslon.ru/api/search.xml'
// Выдача отвечает за треть секунды на десятке товаров и виснет на больших порциях,
// поэтому берём мелкими страницами и повторяем при обрыве.
const PER_PAGE = 10
const ATTEMPTS = 3
// Удачный запрос отвечает за треть секунды, так что ждать дольше десяти секунд бессмысленно:
// это уже зависшее соединение, дешевле оборвать и переспросить
const REQUEST_TIMEOUT_MS = 10_000
const PARALLEL_QUERIES = 8

type Offer = {
  merchantId: string
  article: string
  id: string
  available: boolean
  price: string
  oldPrice: string
  picture: string
  extraPicture: string
  title: string
  description: string
  vendor: string
  url: string
  disclosure: string
}

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

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function tag(block: string, name: string): string {
  const match = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`).exec(
    block,
  )
  return match?.[1] ? decodeEntities(match[1]).trim() : ''
}

function attribute(block: string, name: string): string {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(block)?.[1] ?? ''
}

function parseOffers(xml: string): Offer[] {
  return [...xml.matchAll(/<offer\s[\s\S]*?<\/offer>/g)].map((match) => {
    const block = match[0]
    const pictures = [...block.matchAll(/<picture>([^<]+)<\/picture>/g)].map((one) =>
      decodeEntities(one[1] ?? ''),
    )
    return {
      merchantId: attribute(block, 'merchant_id'),
      article: attribute(block, 'article'),
      id: attribute(block, 'id'),
      available: attribute(block, 'available') !== 'false',
      price: tag(block, 'price'),
      oldPrice: tag(block, 'oldprice'),
      picture: pictures[0] ?? '',
      extraPicture: tag(block, 'original_picture'),
      title: tag(block, 'name'),
      description: tag(block, 'description'),
      vendor: tag(block, 'vendor'),
      url: tag(block, 'url'),
      disclosure: tag(block, 'info'),
    }
  })
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
      return parseOffers(await response.text())
    } catch (error) {
      if (attempt >= ATTEMPTS) {
        console.log(`  «${query}» страница ${page}: ${String(error).slice(0, 60)}`)
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
}

/** Габариты из названия или описания: «120х60х75» или «200 x 300 см». */
function dimensions(text: string): {
  width: number | null
  depth: number | null
  height: number | null
} {
  const sane = (value: string): number | null => {
    const number = Number(value)
    return number >= 15 && number <= 400 ? number : null
  }
  const triple = /(\d{2,3})\s*[х×x*]\s*(\d{2,3})\s*[х×x*]\s*(\d{2,3})/i.exec(text)
  if (triple) {
    return {
      width: sane(triple[1] ?? ''),
      depth: sane(triple[2] ?? ''),
      height: sane(triple[3] ?? ''),
    }
  }
  const pair = /(\d{2,3})\s*[х×x*]\s*(\d{2,3})\s*см/i.exec(text)
  if (pair) {
    return { width: sane(pair[1] ?? ''), depth: sane(pair[2] ?? ''), height: null }
  }
  return { width: null, depth: null, height: null }
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

function toRow(offer: Offer): Row | null {
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
  const price = Math.round(Number(offer.price))
  const [floor, ceiling] = PRICE_RANGE[category]
  if (!Number.isFinite(price) || price < floor || price > ceiling) {
    return null
  }
  const oldPrice = Math.round(Number(offer.oldPrice))
  const measured = dimensions(`${offer.title} ${offer.description}`)
  return {
    // Пара «магазин плюс артикул» переживает переиндексацию сети, внутренний id — нет
    externalId: offer.article ? `${offer.merchantId}-${offer.article}` : offer.id,
    category,
    title: offer.title.slice(0, 200),
    priceRub: price,
    oldPriceRub: Number.isFinite(oldPrice) && oldPrice > price ? oldPrice : null,
    url: offer.url,
    imageUrl: offer.picture,
    imageUrl2: offer.extraPicture,
    // Производитель в фиде часто пустой или прочерк: тогда показываем магазин
    brand: offer.vendor.length > 1 ? offer.vendor : shopOf(offer.url),
    description: offer.description.slice(0, 600),
    color: colorOf(`${offer.title} ${offer.description}`),
    ...measured,
    disclosure: offer.disclosure,
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
] as const

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(rows: Row[]): string {
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
      ]
        .map(cell)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

const token = requireEnv('GDESLON_TOKEN')
const out = argValue('out', 'gdeslon.csv')
const pages = Number(argValue('pages', '12'))

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
