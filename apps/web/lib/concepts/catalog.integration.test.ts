import { EMBEDDING_DIMENSIONS } from '@uyut/ai'
import {
  countItems,
  findSimilar,
  getCatalogItems,
  itemsNeedingEmbedding,
  markMissingOutOfStock,
  saveEmbeddings,
  upsertFeedItems,
} from '@uyut/catalog'
import { auditLog, catalogItems, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runTool } from '@/lib/chat/tools'
import { getDb } from '@/lib/db'

// Единичные векторы по разным осям: косинус между ними ноль, с самим собой единица
function axis(index: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  vector[index] = 1
  return vector
}

const SOURCE = 'dump' as const
const ids = ['it-sofa-a', 'it-sofa-b', 'it-sofa-c', 'it-chair-a', 'it-chair-seat']

describe('catalog in a real database', () => {
  beforeAll(async () => {
    const db = getDb()
    await upsertFeedItems(db, [
      {
        source: SOURCE,
        externalId: 'it-sofa-a',
        category: 'sofa',
        title: 'Диван А',
        priceKopecks: 30_000_00,
        affiliateUrl: 'https://shop/a',
        images: [{ url: 'https://cdn/a.jpg' }],
        inStock: true,
      },
      {
        source: SOURCE,
        externalId: 'it-sofa-b',
        category: 'sofa',
        title: 'Диван Б',
        priceKopecks: 90_000_00,
        affiliateUrl: 'https://shop/b',
        images: [{ url: 'https://cdn/b.jpg' }],
        inStock: true,
      },
      {
        source: SOURCE,
        externalId: 'it-sofa-c',
        category: 'sofa',
        title: 'Диван В, нет в наличии',
        priceKopecks: 10_000_00,
        affiliateUrl: 'https://shop/c',
        images: [{ url: 'https://cdn/c.jpg' }],
        inStock: false,
      },
      {
        source: SOURCE,
        externalId: 'it-chair-a',
        category: 'chair',
        subcategory: 'armchair',
        title: 'Кресло А',
        priceKopecks: 20_000_00,
        affiliateUrl: 'https://shop/d',
        images: [{ url: 'https://cdn/d.jpg' }],
        inStock: true,
      },
      {
        source: SOURCE,
        externalId: 'it-chair-seat',
        category: 'chair',
        subcategory: 'chair',
        title: 'Стул А',
        priceKopecks: 15_000_00,
        affiliateUrl: 'https://shop/e',
        images: [{ url: 'https://cdn/e.jpg' }],
        inStock: true,
      },
    ])
    const rows = await db.select().from(catalogItems).where(eq(catalogItems.source, SOURCE))
    const byExternal = new Map(rows.map((row) => [row.externalId, row]))
    await saveEmbeddings(
      db,
      ids.map((externalId, index) => {
        const row = byExternal.get(externalId)
        if (!row) {
          throw new Error(`нет записи ${externalId}`)
        }
        return {
          id: row.id,
          imageEmbedding: axis(index),
          textEmbedding: null,
          hash: row.contentHash,
        }
      }),
    )
  })

  afterAll(async () => {
    const db = getDb()
    for (const externalId of ids) {
      await db.delete(catalogItems).where(eq(catalogItems.externalId, externalId))
    }
  })

  it('повторный upsert не создаёт дублей и считает обновления', async () => {
    const summary = await upsertFeedItems(getDb(), [
      {
        source: SOURCE,
        externalId: 'it-sofa-a',
        category: 'sofa',
        title: 'Диван А',
        priceKopecks: 31_000_00,
        affiliateUrl: 'https://shop/a',
        images: [{ url: 'https://cdn/a.jpg' }],
        inStock: true,
      },
    ])
    expect(summary).toEqual({ inserted: 0, updated: 1, total: 1 })
    const rows = await getDb()
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, 'it-sofa-a'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priceKopecks).toBe(31_000_00)
  })

  it('ищет ближайший по косинусу в своей категории и ценовом окне', async () => {
    const db = getDb()
    const closestToA = await findSimilar(db, { embedding: axis(0), category: 'sofa', limit: 20 })
    expect(closestToA[0]?.externalId).toBe('it-sofa-a')
    expect(closestToA[0]?.similarity).toBeCloseTo(1, 5)
    // Диван В без наличия не показывается, кресло не в той категории
    expect(closestToA.map((item) => item.externalId)).not.toContain('it-sofa-c')
    expect(closestToA.map((item) => item.externalId)).not.toContain('it-chair-a')

    // В базе могут лежать и другие диваны (демо-каталог), смотрим только на свои записи
    const own = (items: Array<{ externalId: string }>) =>
      items.map((item) => item.externalId).filter((id) => id.startsWith('it-'))
    const cheapOnly = await findSimilar(db, {
      embedding: axis(0),
      category: 'sofa',
      maxPriceKopecks: 50_000_00,
      limit: 20,
    })
    expect(own(cheapOnly)).toEqual(['it-sofa-a'])

    const excluding = await findSimilar(db, {
      embedding: axis(0),
      category: 'sofa',
      excludeIds: closestToA.map((item) => item.id),
      limit: 20,
    })
    expect(own(excluding)).toEqual([])
  })

  it('считает записи с векторами', async () => {
    const totals = await countItems(getDb())
    expect(totals.total).toBeGreaterThanOrEqual(3)
    expect(totals.embedded).toBeGreaterThanOrEqual(3)
  })

  it('пачечно скрывает товары, исчезнувшие из свежего фида', async () => {
    const db = getDb()
    const externalIds = ['it-askona-current', 'it-askona-missing']
    try {
      await upsertFeedItems(
        db,
        externalIds.map((externalId) => ({
          source: 'askona' as const,
          externalId,
          category: 'bed' as const,
          title: externalId,
          priceKopecks: 50_000_00,
          affiliateUrl: `https://shop/${externalId}`,
          images: [{ url: `https://cdn/${externalId}.jpg` }],
          inStock: true,
        })),
      )

      expect(
        await markMissingOutOfStock(db, 'askona', ['it-askona-current']),
      ).toBeGreaterThanOrEqual(1)
      const rows = await db.select().from(catalogItems).where(eq(catalogItems.source, 'askona'))
      const own = new Map(
        rows
          .filter((row) => externalIds.includes(row.externalId))
          .map((row) => [row.externalId, row.inStock]),
      )
      expect(own.get('it-askona-current')).toBe(true)
      expect(own.get('it-askona-missing')).toBe(false)
    } finally {
      for (const externalId of externalIds) {
        await db.delete(catalogItems).where(eq(catalogItems.externalId, externalId))
      }
    }
  })

  it('в строгом режиме не подменяет стул креслом', async () => {
    const matches = await findSimilar(getDb(), {
      embedding: axis(4),
      category: 'chair',
      subcategory: 'chair',
      strictSubcategory: true,
      limit: 5,
    })
    expect(matches.map((item) => item.externalId)).toContain('it-chair-seat')
    expect(matches.map((item) => item.externalId)).not.toContain('it-chair-a')
  })

  it('excludes stale and future records without deleting saved product lookups', async () => {
    const db = getDb()
    const [stale] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, 'it-sofa-a'))
    const [future] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, 'it-sofa-b'))
    if (!stale || !future) throw new Error('Missing freshness fixtures')
    try {
      await db
        .update(catalogItems)
        .set({ lastSyncedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), embeddedHash: null })
        .where(eq(catalogItems.id, stale.id))
      await db
        .update(catalogItems)
        .set({ lastSyncedAt: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(catalogItems.id, future.id))
      const recommendations = await findSimilar(db, {
        embedding: axis(0),
        category: 'sofa',
        limit: 20,
      })
      expect(recommendations.map((item) => item.id)).not.toContain(stale.id)
      expect(recommendations.map((item) => item.id)).not.toContain(future.id)
      expect((await itemsNeedingEmbedding(db, 100)).map((item) => item.id)).not.toContain(stale.id)
      expect(
        (await getCatalogItems(db, [stale.id, future.id])).map((item) => item.id).sort(),
      ).toEqual([stale.id, future.id].sort())
    } finally {
      await db
        .update(catalogItems)
        .set({ lastSyncedAt: stale.lastSyncedAt, embeddedHash: stale.embeddedHash })
        .where(eq(catalogItems.id, stale.id))
      await db
        .update(catalogItems)
        .set({ lastSyncedAt: future.lastSyncedAt })
        .where(eq(catalogItems.id, future.id))
    }
  })

  it('does not fill a subcategory shortage with stale products', async () => {
    const db = getDb()
    const [armchair] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, 'it-chair-a'))
    if (!armchair) throw new Error('Missing armchair')
    try {
      await db
        .update(catalogItems)
        .set({ lastSyncedAt: new Date(Date.now() - 49 * 60 * 60 * 1000) })
        .where(eq(catalogItems.id, armchair.id))
      const relaxed = await findSimilar(db, {
        embedding: axis(4),
        category: 'chair',
        subcategory: 'chair',
        limit: 20,
      })
      expect(relaxed.map((item) => item.externalId)).toContain('it-chair-seat')
      expect(relaxed.map((item) => item.id)).not.toContain(armchair.id)
    } finally {
      await db
        .update(catalogItems)
        .set({ lastSyncedAt: armchair.lastSyncedAt })
        .where(eq(catalogItems.id, armchair.id))
    }
  })

  it('does not use old or future prices in assistant fallback search without AI calls', async () => {
    const db = getDb()
    const [product] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, 'it-sofa-a'))
    if (!product) throw new Error('Missing sofa')
    const [owner] = await db
      .insert(users)
      .values({ email: `catalog-${randomUUID()}@example.test` })
      .returning({ id: users.id })
    if (!owner) throw new Error('Missing owner')
    let projectId: string | null = null
    try {
      const [project] = await db
        .insert(projects)
        .values({ ownerId: owner.id, title: 'Fresh catalogue test' })
        .returning({ id: projects.id })
      if (!project) throw new Error('Missing project')
      projectId = project.id
      const scope = { projectId, userId: owner.id }
      await db.update(catalogItems).set({ priceKopecks: 1 }).where(eq(catalogItems.id, product.id))
      const fresh = await runTool('search_catalog', { category: 'sofa', maxPriceRub: 0.01 }, scope)
      expect(fresh.cards?.map((card) => card.catalogItemId)).toContain(product.id)
      for (const lastSyncedAt of [
        new Date(Date.now() - 49 * 60 * 60 * 1000),
        new Date(Date.now() + 60 * 60 * 1000),
      ]) {
        await db.update(catalogItems).set({ lastSyncedAt }).where(eq(catalogItems.id, product.id))
        const result = await runTool(
          'search_catalog',
          { category: 'sofa', maxPriceRub: 0.01 },
          scope,
        )
        expect(result.cards).toBeUndefined()
        expect(result.text).toContain('В свежем каталоге нет')
      }
    } finally {
      await db
        .update(catalogItems)
        .set({ priceKopecks: product.priceKopecks, lastSyncedAt: product.lastSyncedAt })
        .where(eq(catalogItems.id, product.id))
      if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
      await db.delete(auditLog).where(eq(auditLog.actorId, owner.id))
      await db.delete(users).where(eq(users.id, owner.id))
    }
  })
})

import { randomUUID } from 'node:crypto'
