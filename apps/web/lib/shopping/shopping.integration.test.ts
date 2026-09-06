import { randomUUID } from 'node:crypto'
import { upsertFeedItems } from '@uyut/catalog'
import { catalogItems, projects, rooms, shoppingLists, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemQuantity,
  shoppingQuantities,
} from './repository'

// Настоящая база из docker-compose: владелец, проект, комната и два товара с префиксом it-shop
const run = randomUUID().slice(0, 8)
let ownerId = ''
let strangerId = ''
let projectId = ''
let roomId = ''
let sofaId = ''
let lampId = ''

describe('shopping list in a real database', () => {
  beforeAll(async () => {
    const db = getDb()
    const [owner] = await db
      .insert(users)
      .values({ email: `shop-owner-${run}@example.test` })
      .returning({ id: users.id })
    const [stranger] = await db
      .insert(users)
      .values({ email: `shop-stranger-${run}@example.test` })
      .returning({ id: users.id })
    ownerId = owner?.id ?? ''
    strangerId = stranger?.id ?? ''
    const [project] = await db
      .insert(projects)
      .values({ ownerId, title: `Список ${run}`, budgetKopecks: 500_000_00 })
      .returning({ id: projects.id })
    projectId = project?.id ?? ''
    const [room] = await db
      .insert(rooms)
      .values({ projectId, kind: 'living', name: 'Гостиная', areaM2: 18.4 })
      .returning({ id: rooms.id })
    roomId = room?.id ?? ''
    await upsertFeedItems(db, [
      {
        source: 'dump',
        externalId: `it-shop-sofa-${run}`,
        category: 'sofa',
        title: 'Диван для списка',
        priceKopecks: 67_900_00,
        affiliateUrl: 'https://shop/sofa',
        images: [{ url: 'https://cdn/sofa.jpg' }],
        inStock: true,
      },
      {
        source: 'dump',
        externalId: `it-shop-lamp-${run}`,
        category: 'lamp',
        title: 'Торшер для списка',
        priceKopecks: 6_990_00,
        affiliateUrl: 'https://shop/lamp',
        images: [{ url: 'https://cdn/lamp.jpg' }],
        inStock: true,
      },
    ])
    const products = await db
      .select({ id: catalogItems.id, externalId: catalogItems.externalId })
      .from(catalogItems)
      .where(eq(catalogItems.source, 'dump'))
    sofaId = products.find((p) => p.externalId === `it-shop-sofa-${run}`)?.id ?? ''
    lampId = products.find((p) => p.externalId === `it-shop-lamp-${run}`)?.id ?? ''
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(shoppingLists).where(eq(shoppingLists.projectId, projectId))
    await db.delete(projects).where(eq(projects.id, projectId))
    await db.delete(catalogItems).where(eq(catalogItems.externalId, `it-shop-sofa-${run}`))
    await db.delete(catalogItems).where(eq(catalogItems.externalId, `it-shop-lamp-${run}`))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, strangerId))
  })

  it('starts empty and creates the list on the first add', async () => {
    expect(await getShoppingList(ownerId, projectId)).toEqual({ id: null, items: [], count: 0 })
    const added = await addShoppingItem(ownerId, { projectId, catalogItemId: sofaId, roomId })
    expect(added.quantity).toBe(1)
    const list = await getShoppingList(ownerId, projectId)
    expect(list.id).not.toBeNull()
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      title: 'Диван для списка',
      priceKopecks: 67_900_00,
      quantity: 1,
      roomName: 'Гостиная',
      affiliateUrl: 'https://shop/sofa',
    })
  })

  it('increments the quantity instead of duplicating the same product', async () => {
    const again = await addShoppingItem(ownerId, { projectId, catalogItemId: sofaId, roomId })
    expect(again.quantity).toBe(2)
    const list = await getShoppingList(ownerId, projectId)
    expect(list.items).toHaveLength(1)
    expect(list.count).toBe(2)
    expect(await shoppingQuantities(ownerId, projectId)).toEqual({ [sofaId]: 2 })
  })

  it('keeps a separate row for the same product on another rendered object', async () => {
    const objectId = randomUUID()
    // Чужой uuid предмета не пройдёт по внешнему ключу, поэтому проверяем без привязки
    await expect(
      addShoppingItem(ownerId, { projectId, catalogItemId: sofaId, conceptObjectId: objectId }),
    ).rejects.toThrow()
    await addShoppingItem(ownerId, {
      projectId,
      catalogItemId: lampId,
      variant: { color: 'чёрный', priceKopecks: 7_490_00 },
    })
    const list = await getShoppingList(ownerId, projectId)
    expect(list.items).toHaveLength(2)
    expect(list.items.find((item) => item.catalogItemId === lampId)?.variant).toEqual({
      color: 'чёрный',
      priceKopecks: 7_490_00,
    })
  })

  it('changes quantity and removes rows, zero means remove', async () => {
    const list = await getShoppingList(ownerId, projectId)
    const sofa = list.items.find((item) => item.catalogItemId === sofaId)
    const lamp = list.items.find((item) => item.catalogItemId === lampId)
    if (!sofa || !lamp) {
      throw new Error('строки списка не найдены')
    }
    expect((await setShoppingItemQuantity(ownerId, sofa.id, 3)).quantity).toBe(3)
    expect((await setShoppingItemQuantity(ownerId, lamp.id, 0)).quantity).toBe(0)
    let after = await getShoppingList(ownerId, projectId)
    expect(after.items).toHaveLength(1)
    expect(after.count).toBe(3)
    await removeShoppingItem(ownerId, sofa.id)
    after = await getShoppingList(ownerId, projectId)
    expect(after.items).toHaveLength(0)
    expect(after.id).not.toBeNull()
  })

  it('hides the list and its rows from a stranger', async () => {
    const added = await addShoppingItem(ownerId, { projectId, catalogItemId: lampId })
    await expect(getShoppingList(strangerId, projectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addShoppingItem(strangerId, { projectId, catalogItemId: lampId }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(removeShoppingItem(strangerId, added.itemId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(setShoppingItemQuantity(strangerId, added.itemId, 5)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await getShoppingList(ownerId, projectId)).items).toHaveLength(1)
  })

  it('rejects an unknown product', async () => {
    await expect(
      addShoppingItem(ownerId, { projectId, catalogItemId: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
