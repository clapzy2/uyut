import { randomUUID } from 'node:crypto'
import { findSimilar, getCatalogItems, saveEmbeddings, upsertFeedItems } from '@uyut/catalog'
import { catalogItems, projects, shoppingListItems, shoppingLists, users } from '@uyut/db'
import { and, eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { syncGdeslon } from '../../../../jobs/src/lib/sync-gdeslon'

const merchant = `refresh-qa-${randomUUID()}`
let ownerId: string
let legacyId: string
let shoppingId: string
let legacyDate: Date
let ownsData = false

function response(price = '30000.45', title = 'Диван Тест') {
  return new Response(`<offers><offer id="new-sku" article="model" available="true">
    <merchant_id>${merchant}</merchant_id><name>${title}</name><price>${price}</price>
    <url>https://shop.example/new</url><picture>https://cdn.example/new.jpg</picture>
    <tagging_ads><info>Реклама. Тест erid qa-only</info></tagging_ads>
  </offer></offers>`)
}

describe('обновление Gdeslon сохраняет покупки и не скрывает чужую выборку', () => {
  beforeAll(async () => {
    const address = new URL(process.env.DATABASE_URL ?? '')
    const disposableCi =
      process.env.GITHUB_ACTIONS === 'true' &&
      address.pathname === '/uyut' &&
      address.port === '5432' &&
      address.username === 'uyut' &&
      address.password === 'uyut'
    if (
      !['127.0.0.1', 'localhost'].includes(address.hostname) ||
      (address.pathname !== '/domitsa_ui_qa' && !disposableCi)
    ) {
      throw new Error('Контроль разрешён только в отдельной QA-БД')
    }
    const db = getDb()
    await upsertFeedItems(db, [
      {
        source: 'gdeslon',
        externalId: `${merchant}-model`,
        category: 'sofa',
        title: 'Старый выбранный диван',
        priceKopecks: 2_500_000,
        affiliateUrl: 'https://shop.example/old',
        images: [{ url: 'https://cdn.example/old.jpg' }],
        inStock: true,
      },
    ])
    ownsData = true
    const [legacy] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, `${merchant}-model`))
    if (!legacy) throw new Error('Нет старого товара')
    legacyId = legacy.id
    legacyDate = legacy.lastSyncedAt
    const [owner] = await db
      .insert(users)
      .values({ email: `${merchant}@example.test` })
      .returning()
    if (!owner) throw new Error('Нет владельца')
    ownerId = owner.id
    const [project] = await db
      .insert(projects)
      .values({ ownerId, title: 'Контроль старой покупки' })
      .returning()
    if (!project) throw new Error('Нет проекта')
    const [list] = await db.insert(shoppingLists).values({ projectId: project.id }).returning()
    if (!list) throw new Error('Нет списка')
    const [shopping] = await db
      .insert(shoppingListItems)
      .values({
        listId: list.id,
        catalogItemId: legacyId,
        quantity: 2,
        dimensionsCm: { width: 211.5, depth: 94.6 },
        placementCm: { xCm: 12.5, yCm: 30, rotation: 0 },
      })
      .returning()
    if (!shopping) throw new Error('Нет покупки')
    shoppingId = shopping.id
  })

  afterAll(async () => {
    if (!ownsData) return
    const db = getDb()
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await db
      .delete(catalogItems)
      .where(
        and(eq(catalogItems.source, 'gdeslon'), like(catalogItems.externalId, `${merchant}-%`)),
      )
  })

  it('обновляет только найденный SKU, повторный сбор идемпотентен', async () => {
    const db = getDb()
    const options = {
      queries: ['диван'],
      pages: 1,
      fetcher: (async () => response()) as typeof fetch,
    }
    expect(await syncGdeslon(db, 'qa-key', options)).toMatchObject({
      status: 'ok',
      inserted: 1,
      updated: 0,
      hidden: 0,
      coverage: 'search-subset',
    })
    expect(await syncGdeslon(db, 'qa-key', options)).toMatchObject({
      status: 'ok',
      inserted: 0,
      updated: 1,
      hidden: 0,
    })
    const [legacy] = await getCatalogItems(db, [legacyId])
    expect(legacy).toMatchObject({
      inStock: true,
      priceKopecks: 2_500_000,
      lastSyncedAt: legacyDate,
    })
    const [shopping] = await db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.id, shoppingId))
    expect(shopping).toMatchObject({
      catalogItemId: legacyId,
      quantity: 2,
      dimensionsCm: { width: 211.5, depth: 94.6 },
      placementCm: { xCm: 12.5, yCm: 30, rotation: 0 },
    })
  })

  it('не записывает даже успешную часть при ошибке другой страницы', async () => {
    const db = getDb()
    const before = await db
      .select()
      .from(catalogItems)
      .where(like(catalogItems.externalId, `${merchant}-%`))
    const fetcher = (async (input: Parameters<typeof fetch>[0]) =>
      new URL(String(input)).searchParams.get('q') === 'a'
        ? response('40000')
        : new Response('forbidden', { status: 403 })) as typeof fetch
    expect(
      await syncGdeslon(db, 'qa-key', { queries: ['a', 'b'], pages: 1, fetcher }),
    ).toMatchObject({ status: 'failed', failedPages: 1, inserted: 0, updated: 0 })
    expect(
      await db
        .select()
        .from(catalogItems)
        .where(like(catalogItems.externalId, `${merchant}-%`)),
    ).toEqual(before)
  })

  it('не подбирает товар по прежнему вектору после изменения содержания', async () => {
    const db = getDb()
    const [item] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.externalId, `${merchant}-model-new-sku`))
    if (!item) throw new Error('Нет нового товара')
    const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0))
    await saveEmbeddings(db, [
      { id: item.id, hash: item.contentHash, imageEmbedding: vector, textEmbedding: vector },
    ])
    const query = { embedding: vector, category: 'sofa' as const, limit: 500 }
    expect((await findSimilar(db, query)).map((row) => row.id)).toContain(item.id)
    await syncGdeslon(db, 'qa-key', {
      queries: ['диван'],
      pages: 1,
      fetcher: (async () => response('30000.45', 'Диван Новая обивка')) as typeof fetch,
    })
    expect((await findSimilar(db, query)).map((row) => row.id)).not.toContain(item.id)
    const [changed] = await getCatalogItems(db, [item.id])
    if (!changed) throw new Error('Товар пропал')
    await saveEmbeddings(db, [
      { id: item.id, hash: changed.contentHash, imageEmbedding: vector, textEmbedding: vector },
    ])
    expect((await findSimilar(db, query)).map((row) => row.id)).toContain(item.id)
  })
})
