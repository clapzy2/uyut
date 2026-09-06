import { EMBEDDING_DIMENSIONS } from '@uyut/ai'
import { countItems, findSimilar, saveEmbeddings, upsertFeedItems } from '@uyut/catalog'
import { catalogItems } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'

// Единичные векторы по разным осям: косинус между ними ноль, с самим собой единица
function axis(index: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  vector[index] = 1
  return vector
}

const SOURCE = 'dump' as const
const ids = ['it-sofa-a', 'it-sofa-b', 'it-sofa-c', 'it-chair-a']

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
        title: 'Кресло А',
        priceKopecks: 20_000_00,
        affiliateUrl: 'https://shop/d',
        images: [{ url: 'https://cdn/d.jpg' }],
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
})
