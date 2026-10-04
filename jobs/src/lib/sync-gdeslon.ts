import { upsertFeedItems } from '@uyut/catalog'
import type { Database } from '@uyut/db'
import { collectGdeslon } from './gdeslon-catalog'

/** Нельзя удалять старые ключи: покупки ссылаются на их UUID. Они стареют естественно. */
export async function syncGdeslon(
  database: Database,
  token: string,
  options: Parameters<typeof collectGdeslon>[1] = {},
) {
  const collection = await collectGdeslon(token, options)
  const report = {
    source: 'gdeslon' as const,
    coverage: 'search-subset' as const,
    requestedPages: collection.requestedPages,
    failedPages: collection.failedPages,
    withoutDisclosure: collection.withoutDisclosure,
    received: collection.items.length,
    hidden: 0,
  }
  if (collection.failedPages > 0 || collection.items.length === 0) {
    return { ...report, status: 'failed' as const, inserted: 0, updated: 0 }
  }
  // Записываем только полностью полученную выборку. Ошибка БД откатывает всю пачку.
  const summary = await database.transaction((transaction) =>
    upsertFeedItems(transaction, collection.items),
  )
  return { ...report, ...summary, status: 'ok' as const }
}
