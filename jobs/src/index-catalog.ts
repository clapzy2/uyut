import { logger, schedules, task } from '@trigger.dev/sdk'
import { markMissingOutOfStock, parseYml, upsertFeedItems } from '@uyut/catalog'
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

async function downloadFeed(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    throw new Error(`фид не скачался: ${response.status}`)
  }
  return response.text()
}

async function syncFeeds(): Promise<
  Array<{ source: string; inserted: number; updated: number; hidden: number; skipped: number }>
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
      const xml = await downloadFeed(feed.url)
      const parsed = parseYml(xml, feed.source)
      const summary = await upsertFeedItems(database, parsed.items)
      const hidden = await markMissingOutOfStock(
        database,
        feed.source,
        parsed.items.map((item) => item.externalId),
      )
      results.push({ source: feed.source, ...summary, hidden, skipped: parsed.skipped.length })
      logger.info('feed synced', {
        source: feed.source,
        ...summary,
        hidden,
        skipped: parsed.skipped.length,
      })
    } catch (error) {
      logger.error('feed failed', { source: feed.source, error: String(error) })
      results.push({ source: feed.source, inserted: 0, updated: 0, hidden: 0, skipped: 0 })
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
    return { feeds, embedded: embedded.ok ? embedded.output : null }
  },
})
