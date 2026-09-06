import { createVoyageEmbedder, type Embedder, type EmbedInput } from '@uyut/ai'
import { itemsNeedingEmbedding, saveEmbeddings } from '@uyut/catalog'
import type { CatalogItem, Database } from '@uyut/db'
import sharp from 'sharp'
import { optionalEnv } from './env'
import { readObject } from './s3'

export type EmbedSummary = { processed: number; withImage: number; failedImages: number }

const BATCH = 5
// Без карты Voyage пропускает три запроса в минуту: между пачками выдерживаем паузу
const PAUSE_BETWEEN_BATCHES_MS = 21_000
const IMAGE_SIDE = 512

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

async function downloadImage(url: string): Promise<Buffer | null> {
  const key = ownObjectKey(url)
  if (key) {
    return (await readObject(key)).body
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; UyutBot/1.0)' },
  })
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null
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
  options: { maxItems?: number; log?: (message: string) => void } = {},
): Promise<EmbedSummary> {
  const log = options.log ?? (() => undefined)
  const maxItems = options.maxItems ?? 500
  const summary: EmbedSummary = { processed: 0, withImage: 0, failedImages: 0 }
  while (summary.processed < maxItems) {
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
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_BATCHES_MS))
    }
  }
  return summary
}

export function voyageOrNull(): Embedder | null {
  const key = optionalEnv('VOYAGE_API_KEY')
  return key ? createVoyageEmbedder(key) : null
}
