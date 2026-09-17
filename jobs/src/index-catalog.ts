import { logger, schedules, task } from '@trigger.dev/sdk'
import {
  countItems,
  markMissingOutOfStock,
  parseAdmitadCsv,
  parseAdmitadCsvStream,
  parseYml,
  upsertFeedItems,
} from '@uyut/catalog'
import { type CatalogSource, catalogSources } from '@uyut/db'
import { db } from './lib/db'
import { embedPendingCatalog, voyageOrNull } from './lib/embed-catalog'

/** Фиды из переменных вида ADMITAD_FEED_OZON_URL: источник берётся из имени переменной. */
export function configuredFeeds(
  env: Record<string, string | undefined>,
): Array<{ source: CatalogSource; url: string }> {
  const feeds: Array<{ source: CatalogSource; url: string }> = []
  for (const [name, value] of Object.entries(env)) {
    const match = name.match(/^ADMITAD_FEED_([A-Z]+)_URL$/)
    if (!match || !value) {
      continue
    }
    const source = (match[1] as string).toLowerCase()
    if ((catalogSources as readonly string[]).includes(source)) {
      feeds.push({ source: source as CatalogSource, url: value })
    }
  }
  return feeds
}

async function fetchFeed(url: string): Promise<Response> {
  // Крупные российские фиды могут весить десятки мегабайт и идти из Trigger.dev Cloud
  // заметно дольше двух минут. Задача ограничена 30 минутами, поэтому оставляем ей запас
  // на разбор, запись в базу и запуск векторизации.
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20 * 60_000),
  })
  if (!response.ok) {
    throw new Error(`фид не скачался: ${response.status}`)
  }
  return response
}

async function* decodedChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (text) yield text
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}

export function parsePartnerFeed(text: string, source: CatalogSource, url: string) {
  const looksLikeXml = /^\s*(?:<\?xml|<yml_catalog|<shop)/i.test(text)
  const csvRequested = /(?:[?&](?:format|type)=csv\b|\.csv(?:[?&]|$))/i.test(url)
  return csvRequested || !looksLikeXml ? parseAdmitadCsv(text, source) : parseYml(text, source)
}

async function syncFeeds(): Promise<
  Array<{
    source: string
    inserted: number
    updated: number
    hidden: number
    skipped: number
  }>
> {
  const database = db()
  const results: Array<{
    source: string
    inserted: number
    updated: number
    hidden: number
    skipped: number
  }> = []
  for (const feed of configuredFeeds(process.env)) {
    try {
      const response = await fetchFeed(feed.url)
      const csvRequested = /(?:[?&](?:format|type)=csv\b|\.csv(?:[?&]|$))/i.test(feed.url)
      const parsed =
        csvRequested && response.body
          ? await parseAdmitadCsvStream(decodedChunks(response.body), feed.source)
          : parsePartnerFeed(await response.text(), feed.source, feed.url)
      const skipped = parsed.skippedCount ?? parsed.skipped.length
      const summary = await upsertFeedItems(database, parsed.items)
      const hidden = await markMissingOutOfStock(
        database,
        feed.source,
        parsed.items.map((item) => item.externalId),
      )
      results.push({
        source: feed.source,
        ...summary,
        hidden,
        skipped,
      })
      logger.info('feed synced', {
        source: feed.source,
        ...summary,
        hidden,
        skipped,
      })
    } catch (error) {
      logger.error('feed failed', {
        source: feed.source,
        error: String(error),
      })
      results.push({
        source: feed.source,
        inserted: 0,
        updated: 0,
        hidden: 0,
        skipped: 0,
      })
    }
  }
  return results
}

// Векторы для новых и изменённых записей. Отдельная задача, чтобы дамп или фид можно было
// досчитать вручную, не дожидаясь ночи.
export const embedCatalog = task({
  id: 'embed-catalog',
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (payload: { maxItems?: number }) => {
    const embedder = voyageOrNull()
    if (!embedder) {
      logger.warn('VOYAGE_API_KEY не задан, векторы каталога не считаются')
      return { processed: 0, withImage: 0, failedImages: 0, skipped: true }
    }
    const summary = await embedPendingCatalog(db(), embedder, {
      maxItems: payload.maxItems ?? 500,
      // Пять минут в запасе от maxDuration: задача должна вернуть отчёт сама,
      // а не быть убитой на середине пачки
      maxMs: 25 * 60 * 1000,
      log: (message) => logger.info(message),
    })
    return { ...summary, skipped: false }
  },
})

// Ночная индексация: скачать фиды, обновить каталог, досчитать векторы.
export const indexCatalog = schedules.task({
  id: 'index-catalog',
  cron: '0 3 * * *',
  maxDuration: 1800,
  run: async () => {
    const feeds = await syncFeeds()
    if (feeds.length === 0) {
      logger.info('фиды не настроены, обновляем только векторы')
    }
    const embedded = await embedCatalog.triggerAndWait({ maxItems: 2000 })
    const health = await countItems(db())
    logger.info('catalog health', health)
    return { feeds, embedded: embedded.ok ? embedded.output : null, health }
  },
})
