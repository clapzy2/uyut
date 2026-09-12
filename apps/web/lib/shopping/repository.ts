import { checkFit, type DimensionsCm, type FitVerdict, itemTotalKopecks } from '@uyut/catalog'
import {
  type CatalogCategory,
  catalogItems,
  rooms,
  type ShoppingVariant,
  shoppingListItems,
  shoppingLists,
} from '@uyut/db'
import { and, asc, eq, sql } from 'drizzle-orm'
import { orderedImages } from '@/lib/catalog/product-image'
import { getDb } from '@/lib/db'
import {
  assertOwner,
  assertOwnerOrCollaborator,
  isUuid,
  NotFoundError,
} from '@/lib/projects/access'
import { ownObjectKey, presignedObjectUrl } from '@/lib/storage'

export type ShoppingItemView = {
  id: string
  catalogItemId: string
  title: string
  brand: string | null
  source: string
  category: CatalogCategory
  priceKopecks: number
  affiliateUrl: string
  /** Готовая пометка рекламы от партнёрской сети: показывается целиком, резать нельзя */
  adDisclosure: string | null
  imageUrl: string | null
  /** Запасная ссылка на картинку: первая у части магазинов не отвечает */
  imageFallbackUrl: string | null
  inStock: boolean
  quantity: number
  /** Цена строки: цена варианта или товара, умноженная на количество */
  totalKopecks: number
  variant: ShoppingVariant | null
  roomId: string | null
  roomName: string | null
  conceptObjectId: string | null
  /** Габариты из карточки магазина, сантиметры */
  dimensionsCm: DimensionsCm | null
  /** Влезет ли в промеренные участки стены своей комнаты */
  fit: FitVerdict
}

export type ShoppingListView = {
  id: string | null
  items: ShoppingItemView[]
  /** Сумма количеств: «7 предметов» при шести позициях */
  count: number
}

export type AddShoppingItemInput = {
  projectId: string
  catalogItemId: string
  roomId?: string | null
  conceptObjectId?: string | null
  quantity?: number
  variant?: ShoppingVariant | null
}

const MAX_QUANTITY = 99

async function productImage(url: string | undefined): Promise<string | null> {
  if (!url) {
    return null
  }
  const key = ownObjectKey(url)
  return key ? presignedObjectUrl(key, 60 * 60) : url
}

export async function getShoppingList(
  userId: string,
  projectId: string,
): Promise<ShoppingListView> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  const db = getDb()
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.projectId, project.id))
    .limit(1)
  if (!list) {
    return { id: null, items: [], count: 0 }
  }
  const rows = await db
    .select({
      item: shoppingListItems,
      product: catalogItems,
      roomName: rooms.name,
      measurements: rooms.measurements,
    })
    .from(shoppingListItems)
    .innerJoin(catalogItems, eq(catalogItems.id, shoppingListItems.catalogItemId))
    .leftJoin(rooms, eq(rooms.id, shoppingListItems.roomId))
    .where(eq(shoppingListItems.listId, list.id))
    .orderBy(asc(rooms.orderIndex), asc(shoppingListItems.createdAt))
  const items = await Promise.all(
    rows.map(
      async ({ item, product, roomName, measurements }): Promise<ShoppingItemView> => ({
        id: item.id,
        catalogItemId: product.id,
        title: product.title,
        brand: product.brand,
        source: product.source,
        category: product.category,
        priceKopecks: product.priceKopecks,
        affiliateUrl: item.selectedVariant?.affiliateUrl ?? product.affiliateUrl,
        adDisclosure: product.attributes?.adDisclosure?.trim() || null,
        imageUrl: await productImage(orderedImages(product.images)[0]),
        imageFallbackUrl: await productImage(orderedImages(product.images)[1]),
        inStock: product.inStock,
        quantity: item.quantity,
        totalKopecks: itemTotalKopecks({
          priceKopecks: product.priceKopecks,
          quantity: item.quantity,
          variantPriceKopecks: item.selectedVariant?.priceKopecks ?? null,
        }),
        variant: item.selectedVariant ?? null,
        roomId: item.roomId,
        roomName,
        conceptObjectId: item.conceptObjectId,
        dimensionsCm: product.attributes?.dimensionsCm ?? null,
        fit: checkFit(
          product.attributes?.dimensionsCm,
          measurements?.spots,
          measurements?.ceilingCm,
        ),
      }),
    ),
  )
  return { id: list.id, items, count: items.reduce((sum, item) => sum + item.quantity, 0) }
}

/** Количество по товарам каталога: страница концепта помечает, что уже в списке */
export async function shoppingQuantities(
  userId: string,
  projectId: string,
): Promise<Record<string, number>> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  const rows = await getDb()
    .select({
      catalogItemId: shoppingListItems.catalogItemId,
      quantity: sql<number>`sum(${shoppingListItems.quantity})::int`,
    })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingListItems.listId))
    .where(eq(shoppingLists.projectId, project.id))
    .groupBy(shoppingListItems.catalogItemId)
  return Object.fromEntries(rows.map((row) => [row.catalogItemId, row.quantity]))
}

async function getOrCreateList(projectId: string): Promise<string> {
  const db = getDb()
  const [existing] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(eq(shoppingLists.projectId, projectId))
    .limit(1)
  if (existing) {
    return existing.id
  }
  // Два одновременных добавления: уникальный индекс по проекту не даст второго списка
  const [created] = await db
    .insert(shoppingLists)
    .values({ projectId })
    .onConflictDoNothing()
    .returning({ id: shoppingLists.id })
  if (created) {
    return created.id
  }
  const [row] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(eq(shoppingLists.projectId, projectId))
    .limit(1)
  if (!row) {
    throw new Error('shopping list is missing after insert')
  }
  return row.id
}

/**
 * Добавить товар. Тот же товар к тому же предмету рендера не дублируется, а увеличивает количество.
 */
export async function addShoppingItem(
  userId: string,
  input: AddShoppingItemInput,
): Promise<{ itemId: string; quantity: number }> {
  const project = await assertOwner(userId, input.projectId)
  if (!isUuid(input.catalogItemId)) {
    throw new NotFoundError('Товар не найден')
  }
  const db = getDb()
  const [product] = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(eq(catalogItems.id, input.catalogItemId))
    .limit(1)
  if (!product) {
    throw new NotFoundError('Товар не найден')
  }
  let roomId: string | null = null
  if (input.roomId) {
    const [room] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, input.roomId), eq(rooms.projectId, project.id)))
      .limit(1)
    roomId = room?.id ?? null
  }
  const quantity = Math.min(MAX_QUANTITY, Math.max(1, Math.round(input.quantity ?? 1)))
  const listId = await getOrCreateList(project.id)
  const conceptObjectId = input.conceptObjectId ?? null
  const [existing] = await db
    .select({ id: shoppingListItems.id, quantity: shoppingListItems.quantity })
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.listId, listId),
        eq(shoppingListItems.catalogItemId, product.id),
        sql`${shoppingListItems.conceptObjectId} is not distinct from ${conceptObjectId}::uuid`,
      ),
    )
    .limit(1)
  if (existing) {
    const next = Math.min(MAX_QUANTITY, existing.quantity + quantity)
    await db
      .update(shoppingListItems)
      .set({ quantity: next, ...(input.variant ? { selectedVariant: input.variant } : {}) })
      .where(eq(shoppingListItems.id, existing.id))
    return { itemId: existing.id, quantity: next }
  }
  const [created] = await db
    .insert(shoppingListItems)
    .values({
      listId,
      catalogItemId: product.id,
      roomId,
      conceptObjectId,
      quantity,
      selectedVariant: input.variant ?? null,
    })
    .returning({ id: shoppingListItems.id, quantity: shoppingListItems.quantity })
  if (!created) {
    throw new Error('shopping item insert returned nothing')
  }
  return { itemId: created.id, quantity: created.quantity }
}

async function ownedItem(
  userId: string,
  itemId: string,
): Promise<{ id: string; projectId: string; catalogItemId: string }> {
  if (!isUuid(itemId)) {
    throw new NotFoundError('Строка списка не найдена')
  }
  const [row] = await getDb()
    .select({
      id: shoppingListItems.id,
      projectId: shoppingLists.projectId,
      catalogItemId: shoppingListItems.catalogItemId,
    })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingListItems.listId))
    .where(eq(shoppingListItems.id, itemId))
    .limit(1)
  if (!row) {
    throw new NotFoundError('Строка списка не найдена')
  }
  await assertOwner(userId, row.projectId)
  return row
}

/** Ноль убирает строку целиком */
export async function setShoppingItemQuantity(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<{ projectId: string; quantity: number }> {
  const item = await ownedItem(userId, itemId)
  const next = Math.min(MAX_QUANTITY, Math.max(0, Math.round(quantity)))
  if (next === 0) {
    await getDb().delete(shoppingListItems).where(eq(shoppingListItems.id, item.id))
    return { projectId: item.projectId, quantity: 0 }
  }
  await getDb()
    .update(shoppingListItems)
    .set({ quantity: next })
    .where(eq(shoppingListItems.id, item.id))
  return { projectId: item.projectId, quantity: next }
}

export async function removeShoppingItem(
  userId: string,
  itemId: string,
): Promise<{ projectId: string; catalogItemId: string }> {
  const item = await ownedItem(userId, itemId)
  await getDb().delete(shoppingListItems).where(eq(shoppingListItems.id, item.id))
  return { projectId: item.projectId, catalogItemId: item.catalogItemId }
}
