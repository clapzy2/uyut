import { createHash } from 'node:crypto'
import {
  type CatalogCategory,
  type CatalogItem,
  type CatalogSource,
  catalogItems,
  type Database,
} from '@uyut/db'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { FeedItem } from './types'

/** Хеш того, что влияет на векторы: изменилось — считаем заново. */
export function contentHash(item: Pick<FeedItem, 'title' | 'description' | 'images'>): string {
  return createHash('sha1')
    .update([item.title, item.description ?? '', item.images[0]?.url ?? ''].join('\n'))
    .digest('hex')
}

export type UpsertSummary = { inserted: number; updated: number; total: number }

/**
 * Ежедневный upsert по паре источник плюс внешний id. Пачками по 200, чтобы не упираться
 * в размер одного запроса; поле embedded_hash не трогаем, по нему потом видно, что пересчитать.
 */
export async function upsertFeedItems(db: Database, items: FeedItem[]): Promise<UpsertSummary> {
  let inserted = 0
  let updated = 0
  for (let offset = 0; offset < items.length; offset += 200) {
    const chunk = items.slice(offset, offset + 200)
    const rows = await db
      .insert(catalogItems)
      .values(
        chunk.map((item) => ({
          source: item.source,
          externalId: item.externalId,
          category: item.category,
          subcategory: item.subcategory ?? null,
          brand: item.brand ?? null,
          title: item.title,
          description: item.description ?? null,
          priceKopecks: item.priceKopecks,
          oldPriceKopecks: item.oldPriceKopecks ?? null,
          currency: 'RUB',
          affiliateUrl: item.affiliateUrl,
          images: item.images,
          attributes: item.attributes ?? null,
          variants: item.variants ?? null,
          inStock: item.inStock,
          contentHash: contentHash(item),
          lastSyncedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [catalogItems.source, catalogItems.externalId],
        set: {
          category: sql`excluded.category`,
          subcategory: sql`excluded.subcategory`,
          brand: sql`excluded.brand`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          priceKopecks: sql`excluded.price_kopecks`,
          oldPriceKopecks: sql`excluded.old_price_kopecks`,
          affiliateUrl: sql`excluded.affiliate_url`,
          images: sql`excluded.images`,
          attributes: sql`excluded.attributes`,
          variants: sql`excluded.variants`,
          inStock: sql`excluded.in_stock`,
          contentHash: sql`excluded.content_hash`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` })
    for (const row of rows) {
      if (row.inserted) {
        inserted += 1
      } else {
        updated += 1
      }
    }
  }
  return { inserted, updated, total: items.length }
}

/** Товары источника, которых в свежем фиде не оказалось, помечаются как отсутствующие. */
export async function markMissingOutOfStock(
  db: Database,
  source: CatalogSource,
  presentExternalIds: string[],
): Promise<number> {
  const rows = await db
    .update(catalogItems)
    .set({ inStock: false })
    .where(
      and(
        eq(catalogItems.source, source),
        eq(catalogItems.inStock, true),
        presentExternalIds.length > 0
          ? sql`${catalogItems.externalId} <> all(${presentExternalIds})`
          : sql`true`,
      ),
    )
    .returning({ id: catalogItems.id })
  return rows.length
}

/** Записи, у которых векторов нет или содержимое изменилось после последнего расчёта. */
export async function itemsNeedingEmbedding(db: Database, limit: number): Promise<CatalogItem[]> {
  return db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.inStock, true),
        or(
          isNull(catalogItems.embeddedHash),
          ne(catalogItems.embeddedHash, catalogItems.contentHash),
        ),
      ),
    )
    .limit(limit)
}

export async function saveEmbeddings(
  db: Database,
  rows: Array<{
    id: string
    imageEmbedding: number[] | null
    textEmbedding: number[] | null
    hash: string
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .update(catalogItems)
      .set({
        imageEmbedding: row.imageEmbedding,
        textEmbedding: row.textEmbedding,
        embeddedHash: row.hash,
      })
      .where(eq(catalogItems.id, row.id))
  }
}

export type SimilarQuery = {
  embedding: number[]
  category: CatalogCategory
  minPriceKopecks?: number
  maxPriceKopecks?: number
  limit?: number
  excludeIds?: string[]
}

export type SimilarItem = CatalogItem & { similarity: number }

/**
 * Пять ближайших по картинке в категории и ценовом окне. Косинусная близость = 1 − расстояние.
 * ivfflat-индекс ускоряет поиск, когда каталог вырастет; на сотнях записей идёт полный скан.
 */
export async function findSimilar(db: Database, query: SimilarQuery): Promise<SimilarItem[]> {
  const vector = `[${query.embedding.join(',')}]`
  const conditions = [
    eq(catalogItems.category, query.category),
    eq(catalogItems.inStock, true),
    sql`${catalogItems.imageEmbedding} is not null`,
  ]
  if (query.minPriceKopecks !== undefined) {
    conditions.push(sql`${catalogItems.priceKopecks} >= ${query.minPriceKopecks}`)
  }
  if (query.maxPriceKopecks !== undefined) {
    conditions.push(sql`${catalogItems.priceKopecks} <= ${query.maxPriceKopecks}`)
  }
  if (query.excludeIds && query.excludeIds.length > 0) {
    conditions.push(sql`${catalogItems.id} not in ${query.excludeIds}`)
  }
  const distance = sql<number>`${catalogItems.imageEmbedding} <=> ${vector}::vector`
  const rows = await db
    .select({ item: catalogItems, distance })
    .from(catalogItems)
    .where(and(...conditions))
    .orderBy(distance)
    .limit(query.limit ?? 5)
  return rows.map((row) => ({ ...row.item, similarity: 1 - Number(row.distance) }))
}

export async function countItems(db: Database): Promise<{ total: number; embedded: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      embedded: sql<number>`count(*) filter (where ${catalogItems.imageEmbedding} is not null)`,
    })
    .from(catalogItems)
    .where(eq(catalogItems.inStock, true))
  return { total: Number(row?.total ?? 0), embedded: Number(row?.embedded ?? 0) }
}

export async function getCatalogItems(db: Database, ids: string[]): Promise<CatalogItem[]> {
  if (ids.length === 0) {
    return []
  }
  return db.select().from(catalogItems).where(inArray(catalogItems.id, ids))
}
