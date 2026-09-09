import { createVoyageEmbedder, type Embedder, type EmbedInput } from '@uyut/ai'
import { itemsNeedingEmbedding, saveEmbeddings } from '@uyut/catalog'
import type { CatalogItem, Database } from '@uyut/db'
import sharp from 'sharp'
import { optionalEnv } from './env'
import { readObject } from './s3'

export type EmbedSummary = { processed: number; withImage: number; failedImages: number }

// К ключу привязан способ оплаты, поэтому Voyage считает нас платным тарифом: там сотни
// запросов в минуту вместо трёх, и узким местом становится не он, а скачивание картинок.
// Пауза оставлена небольшой из вежливости и чтобы ночной прогон не занимал канал целиком.
//
// Если ключ вдруг окажется без оплаты, Voyage начнёт отбивать запросы кодом 429 — на них
// векторизатор ждёт и повторяет, так что счёт не сломается, а лишь замедлится.
const BATCH = 20
// Период считается от начала запроса, а не после него: иначе время самого запроса
// прибавляется к паузе и темп падает.
const REQUEST_PERIOD_MS = 1_500
const IMAGE_SIDE = 512
const IMAGE_ATTEMPTS = 3
// Замеряно на живом каталоге: в двадцать потоков доходит восемь картинок из сорока,
// в четыре — двадцать три, в два — тридцать пять. Дальше добирают повторы.
const IMAGE_CONCURRENCY = 2
// Удачная загрузка идёт треть секунды, так что пяти секунд с запасом хватает: всё, что дольше,
// уже повисло, и дешевле оборвать и попросить заново
const IMAGE_TIMEOUT_MS = 5_000

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
 * Обходит список не больше чем `limit` задачами разом, сохраняя порядок результатов.
 *
 * Размер пачки задаёт Voyage, а CDN магазинов — совсем другой сосед: он отбивает запросы
 * не по частоте, а по числу одновременных, и порог у него низкий.
 * Поэтому скачивание разведено с размером пачки.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runner = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await worker(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}

/** Одна попытка забрать файл. Повторы и выбор ссылки — этажом выше, в fetchProductImage. */
async function downloadImage(url: string): Promise<Buffer | null> {
  const key = ownObjectKey(url)
  if (key) {
    return (await readObject(key)).body
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; DomitsaBot/1.0)' },
    })
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null
  } catch {
    return null
  }
}

/**
 * Картинка товара, уменьшенная: Voyage считает токены по пикселям.
 *
 * Ссылки перебираются по порядку. Партнёрская сеть отдаёт свою копию картинки и исходную
 * с сайта магазина, и первая у части товаров просто мертва — молчит до таймаута сколько
 * ни проси. Вторая при этом отвечает, поэтому запасная ссылка здесь не роскошь.
 */
async function fetchProductImage(
  urls: readonly string[],
): Promise<{ body: Buffer; contentType: string } | null> {
  const usable = urls.filter(Boolean)
  // Круг за кругом, а не все попытки по одной ссылке подряд: мёртвая первая ссылка молчит
  // до таймаута, и ждать её трижды прежде чем спросить живую вторую — потерянные полминуты
  // на каждом таком товаре. Повторы всё равно нужны: каждая восьмая живая попытка виснет.
  for (let round = 1; round <= IMAGE_ATTEMPTS; round += 1) {
    for (const url of usable) {
      try {
        const raw = await downloadImage(url)
        if (!raw) {
          continue
        }
        const body = await sharp(raw)
          .resize({
            width: IMAGE_SIDE,
            height: IMAGE_SIDE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toBuffer()
        return { body, contentType: 'image/jpeg' }
      } catch {
        // Битый файл — пробуем следующую ссылку
      }
    }
  }
  return null
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
    const images = await mapWithLimit(items, IMAGE_CONCURRENCY, (item) =>
      fetchProductImage(item.images.map((image) => image.url)),
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
  // Двадцать картинок в base64 плюс расчёт: тридцати секунд на такой запрос не хватает
  return key ? createVoyageEmbedder(key, { timeoutMs: 120_000 }) : null
}
