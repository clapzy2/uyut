import { logger, schedules, task } from '@trigger.dev/sdk'
import {
  countItems,
  markMissingOutOfStock,
  parseAdmitadCsv,
  parseYml,
  syncAdmitadCsvFeed,
  upsertFeedItems,
} from '@uyut/catalog'
import { type CatalogSource, catalogSources } from '@uyut/db'
import { db } from './lib/db'
import { embedPendingCatalog, voyageOrNull } from './lib/embed-catalog'
import { syncGdeslon } from './lib/sync-gdeslon'

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
    // Сохраняем адрес фида, но не обновляем источник до подтверждения доступа
    // и маркировки. Пауза не удаляет ранее выбранные товары пользователя.
    if (env[`ADMITAD_FEED_${match[1]}_PAUSED`] === '1') {
      continue
    }
    const source = (match[1] as string).toLowerCase()
    // Gdeslon обновляется отдельной выборкой API, не полным CSV-фидом.
    if (source === 'gdeslon') continue
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
    await reader.cancel()
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
    warning?: string
  }>
> {
  const database = db()
  const results: Array<{
    source: string
    inserted: number
    updated: number
    hidden: number
    skipped: number
    warning?: string
  }> = []
  for (const feed of configuredFeeds(process.env)) {
    try {
      const response = await fetchFeed(feed.url)
      const csvRequested =
        /(?:[?&](?:format|type)=csv\b|\.csv(?:[?&]|$))/i.test(feed.url) ||
        /\b(?:text|application)\/(?:csv|x-csv)\b/i.test(response.headers.get('content-type') ?? '')
      if (csvRequested && response.body) {
        const summary = await syncAdmitadCsvFeed(
          database,
          decodedChunks(response.body),
          feed.source,
        )
        results.push({ source: feed.source, ...summary })
        logger.info('feed synced', { source: feed.source, ...summary })
        continue
      }
      const parsed = parsePartnerFeed(await response.text(), feed.source, feed.url)
      if (parsed.items.length === 0) throw new Error('В фиде нет доступных товаров мебели')
      const skipped = parsed.skippedCount ?? parsed.skipped.length
      const summary = await upsertFeedItems(database, parsed.items)
      let hidden = 0
      let warning: string | undefined
      try {
        hidden = await markMissingOutOfStock(
          database,
          feed.source,
          parsed.items.map((item) => item.externalId),
        )
      } catch (error) {
        warning = `товары обновлены, но отсутствующие не скрыты: ${String(error)}`
        logger.error('feed cleanup failed', { source: feed.source, error: String(error) })
      }
      results.push({
        source: feed.source,
        ...summary,
        hidden,
        skipped,
        warning,
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
  run: async (payload: { maxItems?: number; source?: CatalogSource; maxMs?: number }) => {
    if (payload.source && !(catalogSources as readonly string[]).includes(payload.source)) {
      throw new Error('Неизвестный источник каталога')
    }
    const embedder = voyageOrNull()
    if (!embedder) {
      logger.warn('VOYAGE_API_KEY не задан, векторы каталога не считаются')
      return { processed: 0, withImage: 0, failedImages: 0, skipped: true }
    }
    const summary = await embedPendingCatalog(db(), embedder, {
      maxItems: payload.maxItems ?? 500,
      source: payload.source,
      // Пять минут в запасе от maxDuration: задача должна вернуть отчёт сама,
      // а не быть убитой на середине пачки
      maxMs: Math.min(payload.maxMs ?? 25 * 60 * 1000, 25 * 60 * 1000),
      log: (message) => logger.info(message),
    })
    return { ...summary, skipped: false }
  },
})

/** Отдельный ручной запуск и общий путь ночного обновления без удаления покупок. */
export const refreshGdeslonCatalog = task({
  id: 'refresh-gdeslon-catalog',
  queue: { concurrencyLimit: 1 },
  maxDuration: 360,
  retry: { maxAttempts: 1 },
  run: async (payload: { pages?: number }) => {
    if (process.env.GDESLON_REFRESH_ENABLED !== '1' || !process.env.GDESLON_TOKEN) {
      return { status: 'skipped' as const, reason: 'Источник не включён или не настроен' }
    }
    let result: Awaited<ReturnType<typeof syncGdeslon>>
    try {
      result = await syncGdeslon(db(), process.env.GDESLON_TOKEN, { pages: payload.pages })
    } catch {
      // Ошибка записи может содержать SQL-параметры с партнёрскими ссылками.
      throw new Error('Обновление Gdeslon не завершено; прежний каталог сохранён')
    }
    if (result.status === 'failed') {
      logger.error('Gdeslon не обновлён; прежние товары сохранены', result)
    } else {
      logger.info('Выборка Gdeslon обновлена', result)
    }
    return result
  },
})

// Ночная индексация: скачать фиды, обновить каталог, досчитать векторы.
export const indexCatalog = schedules.task({
  id: 'index-catalog',
  cron: '0 3 * * *',
  maxDuration: 1800,
  run: async () => {
    const startedAt = Date.now()
    const feeds = await syncFeeds()
    const gdeslon = await refreshGdeslonCatalog.triggerAndWait({})
    if (feeds.length === 0) {
      logger.info('Полные Admitad-фиды не настроены; проверяем Gdeslon и векторы')
    }
    // Оставляем запас на запись отчёта, а не ждём убийства родительской задачи.
    const embeddingBudgetMs = 27 * 60_000 - (Date.now() - startedAt)
    const embedded =
      embeddingBudgetMs > 60_000
        ? await embedCatalog.triggerAndWait({ maxItems: 2000, maxMs: embeddingBudgetMs })
        : null
    const health = await countItems(db())
    logger.info('catalog health', health)
    return {
      feeds,
      gdeslon: gdeslon.ok
        ? gdeslon.output
        : { status: 'failed', reason: 'Задача обновления не завершилась' },
      embedded: embedded?.ok ? embedded.output : null,
      health,
    }
  },
})
