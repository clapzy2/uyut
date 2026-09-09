import { createVoyageEmbedder, type Embedder, type EmbedInput } from '@uyut/ai'
import { itemsNeedingEmbedding, saveEmbeddings } from '@uyut/catalog'
import type { CatalogItem, Database } from '@uyut/db'
import sharp from 'sharp'
import { optionalEnv } from './env'
import { readObject } from './s3'

export type EmbedSummary = { processed: number; withImage: number; failedImages: number }

// Voyage без привязанной карты ограничивает и число запросов, и объём: три запроса в минуту
// при десяти тысячах токенов. Узкое место — второе: картинка 512×512 весит около 470 токенов,
// плюс текст, и пачка из пяти с паузой в 21 секунду выходит примерно на девять тысяч в минуту.
// Отсюда и размер пачки: больше — и запросы начнут отбиваться по 429.
const BATCH = 5
// Период считается от начала запроса, а не после него: иначе время самого запроса
// прибавляется к паузе и темп падает почти на четверть.
const REQUEST_PERIOD_MS = 21_000
const IMAGE_SIDE = 512
const IMAGE_ATTEMPTS = 3
// Удачная загрузка идёт полсекунды, так что восьми секунд с запасом хватает: всё, что дольше,
// уже повисло, и дешевле оборвать и попросить заново
const IMAGE_TIMEOUT_MS = 8_000

/** Ссылка на объект в нашем же bucket: он приватный, поэтому читаем через клиент S3. */
function ownObjectKey(url: string): string | null {
  const endpoint = optionalEnv('S3_ENDPOINT')
  const bucket = optionalEnv('S3_BUCKET')
  if (!endpoint || !bucket) {
    return null
  }
  const prefix = `${endpoint.replace(/\/$/, '')}/${bucket}/`
  return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null
}

/**
 * Картинка товара с чужого CDN. Повторы обязательны: удачная загрузка занимает полсекунды,
 * но примерно каждая третья попытка виснет до таймаута. Без повтора случайный обрыв
 * навсегда оставлял товар без вектора картинки — хеш-то записывается в любом случае.
 */
async function downloadImage(url: string): Promise<Buffer | null> {
  const key = ownObjectKey(url)
  if (key) {
    return (await readObject(key)).body
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; DomitsaBot/1.0)' },
      })
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer())
      }
      // Ответ пришёл: это не обрыв, а «нет такой картинки» — повторять нечего
      return null
    } catch {
      if (attempt >= IMAGE_ATTEMPTS) {
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
}

/** Картинка товара по ссылке из фида, уменьшенная: Voyage считает токены по пикселям. */
async function fetchProductImage(
  url: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const raw = await downloadImage(url)
    if (!raw) {
      return null
    }
    const body = await sharp(raw)
      .resize({ width: IMAGE_SIDE, height: IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { body, contentType: 'image/jpeg' }
  } catch {
    return null
  }
}

function textOf(item: CatalogItem): string {
  return [item.title, item.subcategory, item.brand, item.description?.slice(0, 400)]
    .filter(Boolean)
    .join('. ')
}

/**
 * Векторы для записей без них или с изменившимся содержимым. Картинка и текст считаются
 * одним запросом на пачку. Если картинка не скачалась, остаётся текстовый вектор, а хеш
 * всё равно фиксируется, чтобы не пробовать одно и то же каждую ночь.
 */
export async function embedPendingCatalog(
  db: Database,
  embedder: Embedder,
  options: { maxItems?: number; maxMs?: number; log?: (message: string) => void } = {},
): Promise<EmbedSummary> {
  const log = options.log ?? (() => undefined)
  const maxItems = options.maxItems ?? 500
  // Темп задаёт Voyage, поэтому счёт большого каталога идёт часами. Задача обязана уложиться
  // в отведённое ей время и уйти по-хорошему: остальное досчитается следующим запуском.
  const deadline = options.maxMs ? Date.now() + options.maxMs : null
  const summary: EmbedSummary = { processed: 0, withImage: 0, failedImages: 0 }
  while (summary.processed < maxItems) {
    if (deadline && Date.now() >= deadline) {
      log(`время вышло, посчитано ${summary.processed}, остальное в следующий раз`)
      break
    }
    const startedAt = Date.now()
    const items = await itemsNeedingEmbedding(db, Math.min(BATCH, maxItems - summary.processed))
    if (items.length === 0) {
      break
    }
    const images = await Promise.all(
      items.map((item) => fetchProductImage(item.images[0]?.url ?? '')),
    )
    const inputs: EmbedInput[] = []
    const plan: Array<{ item: CatalogItem; imageIndex: number | null; textIndex: number }> = []
    items.forEach((item, index) => {
      const image = images[index]
      let imageIndex: number | null = null
      if (image) {
        imageIndex = inputs.length
        inputs.push({ image })
      } else {
        summary.failedImages += 1
      }
      const textIndex = inputs.length
      inputs.push({ text: textOf(item) })
      plan.push({ item, imageIndex, textIndex })
    })
    const vectors = await embedder.embed(inputs)
    await saveEmbeddings(
      db,
      plan.map(({ item, imageIndex, textIndex }) => ({
        id: item.id,
        imageEmbedding: imageIndex === null ? null : (vectors[imageIndex] ?? null),
        textEmbedding: vectors[textIndex] ?? null,
        hash: item.contentHash,
      })),
    )
    summary.processed += items.length
    summary.withImage += plan.filter((entry) => entry.imageIndex !== null).length
    log(`векторы: ${summary.processed} записей, без картинки ${summary.failedImages}`)
    if (items.length === BATCH) {
      const rest = REQUEST_PERIOD_MS - (Date.now() - startedAt)
      if (rest > 0) {
        await new Promise((resolve) => setTimeout(resolve, rest))
      }
    }
  }
  return summary
}

export function voyageOrNull(): Embedder | null {
  const key = optionalEnv('VOYAGE_API_KEY')
  // Пять картинок в base64 плюс расчёт: тридцати секунд на такой запрос впритык
  return key ? createVoyageEmbedder(key, { timeoutMs: 90_000 }) : null
}
