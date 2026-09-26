import { randomUUID } from 'node:crypto'
import { upsertFeedItems } from '@uyut/catalog'
import {
  catalogItems,
  conceptObjects,
  concepts,
  projects,
  rooms,
  shoppingLists,
  users,
} from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { buildPdfData, loadSnapshot } from '../../../../jobs/src/lib/pdf-data'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemPlacement,
  setShoppingItemQuantity,
  setShoppingItemSize,
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
        variants: [
          {
            color: 'зелёный велюр',
            priceKopecks: 79_900_00,
            imageUrl: 'https://cdn.example/green.jpg',
            affiliateUrl: 'https://shop.example/green',
          },
        ],
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
        variants: [{ color: 'чёрный', priceKopecks: 7_490_00 }],
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
    // Неизвестный предмет отклоняется до записи строки.
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

  it('stores and clears an exact placement only for the owner', async () => {
    const added = await addShoppingItem(ownerId, { projectId, catalogItemId: sofaId, roomId })
    await setShoppingItemPlacement(ownerId, added.itemId, {
      xCm: 35,
      yCm: 70,
      rotation: 90,
      frontDirection: 'left',
    })
    expect((await getShoppingList(ownerId, projectId)).items[0]?.placementCm).toEqual({
      xCm: 35,
      yCm: 70,
      rotation: 90,
      frontDirection: 'left',
    })
    await expect(
      setShoppingItemPlacement(strangerId, added.itemId, { xCm: 0, yCm: 0, rotation: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await setShoppingItemPlacement(ownerId, added.itemId, null)
    expect((await getShoppingList(ownerId, projectId)).items[0]?.placementCm).toBeNull()
    await removeShoppingItem(ownerId, added.itemId)
  })

  it('hides the list and its rows from a stranger', async () => {
    const added = await addShoppingItem(ownerId, { projectId, catalogItemId: lampId })
    await expect(getShoppingList(strangerId, projectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addShoppingItem(strangerId, { projectId, catalogItemId: lampId }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(removeShoppingItem(strangerId, added.itemId)).rejects.toBeInstanceOf(NotFoundError)
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

  it('keeps the selected fabric and user dimensions from the real list into PDF data', async () => {
    const variant = {
      color: 'зелёный велюр',
      priceKopecks: 79_900_00,
      imageUrl: 'https://cdn.example/green.jpg',
      affiliateUrl: 'https://shop.example/green',
    }
    const added = await addShoppingItem(ownerId, {
      projectId,
      catalogItemId: sofaId,
      roomId,
      quantity: 2,
      variant,
    })
    try {
      await setShoppingItemSize(ownerId, added.itemId, { width: 210, depth: 90 })
      const list = await getShoppingList(ownerId, projectId)
      expect(list.items.find((item) => item.id === added.itemId)).toMatchObject({
        variant,
        dimensionsCm: { width: 210, depth: 90 },
        totalKopecks: 159_800_00,
      })
      const snapshot = await loadSnapshot(projectId)
      if (!snapshot) throw new Error('Missing project snapshot')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
      const pdf = await buildPdfData({
        snapshot,
        kind: 'free',
        options: {},
        rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
        brief: null,
        summary: null,
      })
      const sofa = pdf.shopping
        .flatMap((group) => group.items)
        .find((item) => item.title === 'Диван для списка')
      expect(sofa).toMatchObject({
        affiliateUrl: variant.affiliateUrl,
        quantity: 2,
        priceKopecks: variant.priceKopecks,
        totalKopecks: 159_800_00,
      })
      expect(sofa?.meta).toContain('зелёный велюр')
      expect(sofa?.meta).toContain('ширина 210 см, глубина 90 см')
    } finally {
      vi.unstubAllGlobals()
      await removeShoppingItem(ownerId, added.itemId)
    }
  })

  it('separates fabrics and rooms and serializes concurrent additions', async () => {
    const [otherRoom] = await getDb()
      .insert(rooms)
      .values({ projectId, kind: 'bedroom', name: 'Спальня', areaM2: 12 })
      .returning({ id: rooms.id })
    if (!otherRoom) throw new Error('Missing bedroom')
    const createdIds = new Set<string>()
    try {
      const basic = await addShoppingItem(ownerId, { projectId, catalogItemId: sofaId, roomId })
      createdIds.add(basic.itemId)
      const green = await addShoppingItem(ownerId, {
        projectId,
        catalogItemId: sofaId,
        roomId,
        variant: {
          color: 'зелёный велюр',
          affiliateUrl: 'https://shop.example/green',
          priceKopecks: 1,
          imageUrl: 'https://untrusted.example/image',
        },
      })
      createdIds.add(green.itemId)
      const bedroom = await addShoppingItem(ownerId, {
        projectId,
        catalogItemId: sofaId,
        roomId: otherRoom.id,
      })
      createdIds.add(bedroom.itemId)
      expect(createdIds.size).toBe(3)
      const additions = await Promise.all(
        Array.from({ length: 4 }, () =>
          addShoppingItem(ownerId, { projectId, catalogItemId: sofaId, roomId }),
        ),
      )
      expect(additions.every((item) => item.itemId === basic.itemId)).toBe(true)
      const list = await getShoppingList(ownerId, projectId)
      expect(list.items.find((item) => item.id === basic.itemId)?.quantity).toBe(5)
      expect(list.items.find((item) => item.id === green.itemId)?.variant).toEqual({
        color: 'зелёный велюр',
        affiliateUrl: 'https://shop.example/green',
        priceKopecks: 79_900_00,
        imageUrl: 'https://cdn.example/green.jpg',
      })
      await expect(
        addShoppingItem(ownerId, {
          projectId,
          catalogItemId: sofaId,
          roomId: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    } finally {
      for (const id of createdIds) await removeShoppingItem(ownerId, id)
      await getDb().delete(rooms).where(eq(rooms.id, otherRoom.id))
    }
  })

  it('rejects real foreign objects and derives the room only for owned objects', async () => {
    const db = getDb()
    const [foreignProject] = await db
      .insert(projects)
      .values({ ownerId: strangerId, title: 'Чужой проект' })
      .returning({ id: projects.id })
    if (!foreignProject) throw new Error('Missing foreign project')
    let itemId: string | null = null
    let ownedConceptId: string | null = null
    try {
      const [foreignRoom] = await db
        .insert(rooms)
        .values({ projectId: foreignProject.id, kind: 'living', name: 'Чужая комната', areaM2: 18 })
        .returning({ id: rooms.id })
      if (!foreignRoom) throw new Error('Missing foreign room')
      const [foreignConcept, ownedConcept] = await db
        .insert(concepts)
        .values([
          { roomId: foreignRoom.id, batchId: randomUUID(), prompt: 'test', aiModel: 'offline' },
          { roomId, batchId: randomUUID(), prompt: 'test', aiModel: 'offline' },
        ])
        .returning({ id: concepts.id })
      if (!foreignConcept || !ownedConcept) throw new Error('Missing concepts')
      ownedConceptId = ownedConcept.id
      const [foreignObject, ownedObject] = await db
        .insert(conceptObjects)
        .values([
          {
            conceptId: foreignConcept.id,
            category: 'sofa' as const,
            label: 'Диван',
            bbox: { x: 0, y: 0, w: 1, h: 1 },
            embedding: Array(1024).fill(0),
          },
          {
            conceptId: ownedConcept.id,
            category: 'sofa' as const,
            label: 'Диван',
            bbox: { x: 0, y: 0, w: 1, h: 1 },
            embedding: Array(1024).fill(0),
          },
        ])
        .returning({ id: conceptObjects.id })
      if (!foreignObject || !ownedObject) throw new Error('Missing objects')
      await expect(
        addShoppingItem(ownerId, {
          projectId,
          catalogItemId: sofaId,
          conceptObjectId: foreignObject.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        addShoppingItem(ownerId, {
          projectId,
          catalogItemId: sofaId,
          roomId: foreignRoom.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
      const added = await addShoppingItem(ownerId, {
        projectId,
        catalogItemId: sofaId,
        conceptObjectId: ownedObject.id,
      })
      itemId = added.itemId
      expect(
        (await getShoppingList(ownerId, projectId)).items.find((item) => item.id === itemId)
          ?.roomId,
      ).toBe(roomId)
    } finally {
      if (itemId) await removeShoppingItem(ownerId, itemId)
      if (ownedConceptId) await db.delete(concepts).where(eq(concepts.id, ownedConceptId))
      await db.delete(projects).where(eq(projects.id, foreignProject.id))
    }
  })
})
