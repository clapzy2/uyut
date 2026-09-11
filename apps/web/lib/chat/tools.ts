import { createVoyageEmbedder, priceWindow } from '@uyut/ai'
import { findSimilar, getCatalogItems, isCatalogCategory, type SimilarItem } from '@uyut/catalog'
import {
  type CatalogCategory,
  type ChatCard,
  type ChatProposal,
  catalogItems,
  conceptObjects,
  concepts,
  rooms,
} from '@uyut/db'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { recordAudit } from '@/lib/audit'
import { displayImage } from '@/lib/catalog/product-image'
import { categoryLabels, formatPrice } from '@/lib/concepts/format'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import {
  AccessError,
  assertOwnerOrCollaborator,
  NotFoundError,
  requireOwner,
} from '@/lib/projects/access'
import { ownObjectKey, presignedObjectUrl } from '@/lib/storage'
import type { ChatScope } from './context'

export type ToolResult = { text: string; cards?: ChatCard[]; proposal?: ChatProposal }

type Scope = ChatScope & { userId: string }

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/\s/g, ''))
  return Number.isFinite(number) && number > 0 ? number : undefined
}

async function cardFor(item: SimilarItem, objectId?: string): Promise<ChatCard> {
  const url = displayImage(item.images)
  const key = url ? ownObjectKey(url) : null
  return {
    kind: 'product',
    catalogItemId: item.id,
    title: item.title,
    priceKopecks: item.priceKopecks,
    imageUrl: url ? (key ? await presignedObjectUrl(key, 60 * 60) : url) : null,
    affiliateUrl: item.affiliateUrl,
    adDisclosure: item.attributes?.adDisclosure?.trim() || undefined,
    objectId,
  }
}

async function objectInProject(scope: Scope, objectId: string) {
  const [row] = await getDb()
    .select({ object: conceptObjects, room: rooms })
    .from(conceptObjects)
    .innerJoin(concepts, eq(concepts.id, conceptObjects.conceptId))
    .innerJoin(rooms, eq(rooms.id, concepts.roomId))
    .where(and(eq(conceptObjects.id, objectId), eq(rooms.projectId, scope.projectId)))
    .limit(1)
  if (!row) {
    throw new NotFoundError('Предмет не найден')
  }
  return row
}

/**
 * Поиск: по вектору предмета с рендера, если он указан, иначе по тексту запроса через Voyage.
 * Без ключа Voyage остаётся честный фильтр по категории и цене.
 */
async function searchCatalog(scope: Scope, args: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb()
  const category = str(args.category)?.toLowerCase()
  if (!category || !isCatalogCategory(category)) {
    return {
      text: 'Не понял категорию. Допустимые: sofa, chair, table, storage, lamp, rug, bed, decor.',
    }
  }
  const maxPriceRub = num(args.maxPriceRub)
  const maxPriceKopecks = maxPriceRub ? Math.round(maxPriceRub * 100) : undefined
  const objectId = str(args.objectId)
  const project = await assertOwnerOrCollaborator(scope.userId, scope.projectId)

  let embedding: number[] | null = null
  if (objectId) {
    const { object } = await objectInProject(scope, objectId)
    embedding = object.editedEmbedding ?? object.embedding
  } else {
    const query = str(args.query)
    const key = getEnv().VOYAGE_API_KEY
    if (query && key) {
      const [vector] = await createVoyageEmbedder(key).embed([{ text: query }])
      embedding = vector ?? null
    }
  }

  let items: SimilarItem[]
  if (embedding) {
    const window = maxPriceKopecks
      ? null
      : priceWindow(project.budgetKopecks, category as CatalogCategory)
    items = await findSimilar(db, {
      embedding,
      category: category as CatalogCategory,
      maxPriceKopecks: maxPriceKopecks ?? window?.maxKopecks,
      limit: 5,
      by: objectId ? 'image' : 'text',
    })
    if (items.length < 3) {
      const extra = await findSimilar(db, {
        embedding,
        category: category as CatalogCategory,
        maxPriceKopecks,
        limit: 5 - items.length,
        excludeIds: items.map((item) => item.id),
        by: objectId ? 'image' : 'text',
      })
      items = [...items, ...extra]
    }
  } else {
    const rows = await db
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.category, category as CatalogCategory),
          eq(catalogItems.inStock, true),
          maxPriceKopecks ? sql`${catalogItems.priceKopecks} <= ${maxPriceKopecks}` : sql`true`,
        ),
      )
      .orderBy(asc(catalogItems.priceKopecks))
      .limit(5)
    items = rows.map((row) => ({ ...row, similarity: 0 }))
  }

  if (items.length === 0) {
    return {
      text: `В каталоге нет товаров категории «${categoryLabels[category as CatalogCategory]}»${maxPriceRub ? ` до ${maxPriceRub} ₽` : ''}.`,
    }
  }
  const cards = await Promise.all(items.map((item) => cardFor(item, objectId)))
  const summary = items
    .map((item) => `${item.title} — ${formatPrice(item.priceKopecks)} (catalogItemId ${item.id})`)
    .join('; ')
  return { text: `Найдено ${items.length}: ${summary}. Карточки уже показаны человеку.`, cards }
}

async function replaceMatch(scope: Scope, args: Record<string, unknown>): Promise<ToolResult> {
  const objectId = str(args.objectId)
  const catalogItemId = str(args.catalogItemId)
  if (!objectId || !catalogItemId) {
    return { text: 'Нужны objectId и catalogItemId.' }
  }
  const { object } = await objectInProject(scope, objectId)
  const project = await assertOwnerOrCollaborator(scope.userId, scope.projectId)
  requireOwner(project.role)
  const [item] = await getCatalogItems(getDb(), [catalogItemId])
  if (!item) {
    return { text: 'Такого товара в каталоге нет.' }
  }
  if (item.category !== object.category) {
    return {
      text: `Это ${categoryLabels[item.category].toLowerCase()}, а предмет №${object.orderIndex + 1} — ${categoryLabels[object.category].toLowerCase()}. Замена не подходит.`,
    }
  }
  await getDb()
    .update(conceptObjects)
    .set({ matchedCatalogItemId: item.id })
    .where(eq(conceptObjects.id, object.id))
  return {
    text: `Готово: у предмета №${object.orderIndex + 1} теперь «${item.title}», ${formatPrice(item.priceKopecks)}.`,
  }
}

async function estimate(scope: Scope, args: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb()
  const project = await assertOwnerOrCollaborator(scope.userId, scope.projectId)
  const roomId = str(args.roomId) ?? scope.roomId ?? null
  const roomFilter = roomId ? eq(rooms.id, roomId) : sql`true`
  const likedConcepts = await db
    .select({ concept: concepts, room: rooms })
    .from(concepts)
    .innerJoin(rooms, eq(rooms.id, concepts.roomId))
    .where(and(eq(rooms.projectId, project.id), eq(concepts.likedByOwner, true), roomFilter))
    .orderBy(desc(concepts.createdAt))
  if (likedConcepts.length === 0) {
    return {
      text: 'Понравившихся концептов пока нет, считать нечего. Предложите отметить сердечком те, что нравятся.',
    }
  }
  const conceptIds = likedConcepts.map(({ concept }) => concept.id)
  const matched = await db
    .select({ object: conceptObjects, item: catalogItems })
    .from(conceptObjects)
    .innerJoin(catalogItems, eq(catalogItems.id, conceptObjects.matchedCatalogItemId))
    .where(
      and(
        inArray(conceptObjects.conceptId, conceptIds),
        isNotNull(conceptObjects.matchedCatalogItemId),
      ),
    )
  // Смета по самому свежему лайкнутому концепту каждой комнаты, чтобы не складывать дубли
  const perRoom = new Map<string, { room: string; total: number; items: string[] }>()
  const latestByRoom = new Map<string, string>()
  for (const { concept, room } of likedConcepts) {
    if (!latestByRoom.has(room.id)) {
      latestByRoom.set(room.id, concept.id)
      perRoom.set(room.id, { room: room.name, total: 0, items: [] })
    }
  }
  for (const { object, item } of matched) {
    const roomEntry = [...latestByRoom.entries()].find(
      ([, conceptId]) => conceptId === object.conceptId,
    )
    if (!roomEntry) continue
    const entry = perRoom.get(roomEntry[0])
    if (!entry) continue
    entry.total += item.priceKopecks
    entry.items.push(
      `${categoryLabels[object.category]}: ${item.title} ${formatPrice(item.priceKopecks)}`,
    )
  }
  const total = [...perRoom.values()].reduce((sum, entry) => sum + entry.total, 0)
  const lines = [...perRoom.values()].map(
    (entry) =>
      `${entry.room}: ${formatPrice(entry.total)} (${entry.items.join('; ') || 'подобранных товаров нет'})`,
  )
  const budget = project.budgetKopecks
  const verdict = budget
    ? total > budget
      ? `Это больше бюджета ${formatPrice(budget)} на ${formatPrice(total - budget)}.`
      : `Бюджет ${formatPrice(budget)}, остаётся ${formatPrice(budget - total)}.`
    : 'Бюджет в проекте не указан.'
  return {
    text: `${lines.join(' ')} Итого ${formatPrice(total)}. ${verdict} Смета по мебели с рендеров, без отделки.`,
  }
}

async function proposeRegeneration(
  scope: Scope,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const roomId = str(args.roomId) ?? scope.roomId
  const revision = str(args.revision)
  const summaryRu = str(args.summaryRu) ?? 'Новый вариант с вашими правками.'
  if (!roomId || !revision) {
    return { text: 'Нужны roomId и revision.' }
  }
  const [room] = await getDb()
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.projectId, scope.projectId)))
    .limit(1)
  if (!room) {
    return { text: 'Такой комнаты в проекте нет.' }
  }
  return {
    text: `Предложение показано человеку с кнопкой подтверждения: «${summaryRu}». Больше ничего делать не нужно, генерация стартует только по кнопке.`,
    proposal: {
      kind: 'regeneration',
      roomId: room.id,
      revision,
      summaryRu,
      // Человек смотрит на конкретный вариант — значит правка относится к нему, а не ко всей комнате
      ...(scope.conceptId && roomId === scope.roomId ? { conceptId: scope.conceptId } : {}),
      status: 'pending',
    },
  }
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  scope: Scope,
): Promise<ToolResult> {
  await recordAudit({
    action: 'chat.tool',
    actorId: scope.userId,
    targetType: 'project',
    targetId: scope.projectId,
    metadata: { tool: name, args },
  })
  try {
    switch (name) {
      case 'search_catalog':
        return await searchCatalog(scope, args)
      case 'replace_match':
        return await replaceMatch(scope, args)
      case 'estimate':
        return await estimate(scope, args)
      case 'propose_regeneration':
        return await proposeRegeneration(scope, args)
      default:
        return { text: `Инструмента ${name} нет.` }
    }
  } catch (error) {
    if (error instanceof AccessError) {
      return { text: error.message }
    }
    console.error(error)
    return { text: 'Инструмент не сработал, ответьте человеку без него.' }
  }
}
