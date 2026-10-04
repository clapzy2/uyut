import type { CatalogSource, Database } from '@uyut/db'
import { sql } from 'drizzle-orm'
import { admitadCsvBatches } from './csv'
import { type UpsertSummary, upsertFeedItems } from './repository'
import type { FeedItem } from './types'

/**
 * Большой CSV не удерживается в памяти: промежуточные товары живут в таблице одной
 * транзакции. Только полный фид заменяет каталог; ошибка чтения откатывает изменения.
 */
export async function syncAdmitadCsvFeed(
  database: Database,
  chunks: AsyncIterable<string>,
  source: CatalogSource,
): Promise<UpsertSummary & { hidden: number; skipped: number }> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      create temporary table catalog_feed_stage (
        external_id text primary key,
        item jsonb not null
      ) on commit drop
    `)
    let skipped = 0
    for await (const batch of admitadCsvBatches(chunks, source)) {
      skipped += batch.skippedCount ?? batch.skipped.length
      if (batch.items.length === 0) continue
      await transaction.execute(sql`
        insert into catalog_feed_stage as staged (external_id, item)
        select item->>'externalId', item
        from jsonb_array_elements(${JSON.stringify(batch.items)}::jsonb) as incoming(item)
        on conflict (external_id) do update set item = jsonb_set(
          staged.item,
          '{variants}',
          coalesce((
            select jsonb_agg(variant order by position) from (
              select variant, position from (
                select distinct on (variant->>'affiliateUrl', variant->>'imageUrl')
                  variant, position
                from jsonb_array_elements(
                  coalesce(staged.item->'variants', '[]'::jsonb) ||
                  coalesce(excluded.item->'variants', '[]'::jsonb)
                ) with ordinality as versions(variant, position)
                order by variant->>'affiliateUrl', variant->>'imageUrl', position
              ) as unique_versions
              order by position limit 24
            ) as limited_versions
          ), '[]'::jsonb)
        )
      `)
    }

    const summary: UpsertSummary = { inserted: 0, updated: 0, total: 0 }
    let cursor: string | null = null
    while (true) {
      const batch: Array<{ external_id: string; item: FeedItem }> = await transaction.execute(sql`
        select external_id, item from catalog_feed_stage
        where ${cursor}::text is null or external_id > ${cursor}
        order by external_id limit 200
      `)
      const last = batch.at(-1)
      if (!last) break
      const written = await upsertFeedItems(
        transaction,
        batch.map((row) => row.item),
      )
      summary.inserted += written.inserted
      summary.updated += written.updated
      summary.total += written.total
      cursor = last.external_id
    }
    // Пустой или неподходящий ответ партнёра не должен скрыть весь рабочий каталог.
    if (summary.total === 0)
      throw new Error('В фиде нет доступных товаров мебели; каталог сохранён')
    const [result] = await transaction.execute<{ hidden: string }>(sql`
      with hidden_items as (
        update catalog_items set in_stock = false
        where source = ${source} and in_stock = true
          and not exists (
            select 1 from catalog_feed_stage where external_id = catalog_items.external_id
          )
        returning 1
      ) select count(*) as hidden from hidden_items
    `)
    return { ...summary, hidden: Number(result?.hidden ?? 0), skipped }
  })
}
