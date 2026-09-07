import { MATCH_CONFIDENCE_THRESHOLD, type PriceWindow, priceWindow } from '@uyut/ai'
import { findSimilar, type SimilarItem } from '@uyut/catalog'
import {
  type CatalogCategory,
  type ConceptBbox,
  type ConceptObject,
  conceptObjects,
  concepts,
  type ObjectsStatus,
  type ProjectRole,
} from '@uyut/db'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { getRoom } from '@/lib/projects/repository'
import { shoppingQuantities } from '@/lib/shopping/repository'
import { ownObjectKey, presignedObjectUrl } from '@/lib/storage'

export type MatchView = {
  id: string
  title: string
  brand: string | null
  source: string
  priceKopecks: number
  oldPriceKopecks: number | null
  affiliateUrl: string
  imageUrl: string | null
  similarity: number
  overBudget: boolean
}

export type ObjectView = {
  id: string
  orderIndex: number
  category: CatalogCategory
  label: string
  bbox: ConceptBbox
  maskSrc: string | null
  /** Ключ маски для канвы: пиксели читаются через наш домен */
  maskKey: string | null
  swatchId: string | null
  confidence: number | null
  window: PriceWindow | null
  /** Лучшее совпадение ниже порога: панель называется «Похожие по стилю» */
  styleOnly: boolean
  matches: MatchView[]
}

export type ConceptPageData = {
  /** Роль того, кто смотрит: второй участник только смотрит и ставит отметки */
  role: ProjectRole
  concept: {
    id: string
    status: string
    objectsStatus: ObjectsStatus
    objectsError: string | null
    /** Оценка того, кто смотрит: у владельца и второго участника они свои */
    liked: boolean | null
    /** Что показываем: отредактированный рендер, если он есть */
    renderSrc: string | null
    /** Ключ исходного рендера для канвы */
    renderKey: string | null
    editedRenderKey: string | null
    note: string | null
    orderIndex: number
    batchId: string
  }
  room: {
    id: string
    name: string
    projectId: string
    projectTitle: string
    budgetKopecks: number | null
  }
  objects: ObjectView[]
  /** Что уже в списке покупок проекта: количество по товару каталога и общий счётчик */
  shopping: { byCatalogItem: Record<string, number>; count: number }
}

const MATCHES = 5
const MIN_IN_BUDGET = 3

async function productImage(url: string | undefined): Promise<string | null> {
  if (!url) {
    return null
  }
  const key = ownObjectKey(url)
  return key ? presignedObjectUrl(key, 60 * 60) : url
}

async function toMatch(item: SimilarItem, window: PriceWindow | null): Promise<MatchView> {
  return {
    id: item.id,
    title: item.title,
    brand: item.brand,
    source: item.source,
    priceKopecks: item.priceKopecks,
    oldPriceKopecks: item.oldPriceKopecks,
    affiliateUrl: item.affiliateUrl,
    imageUrl: await productImage(item.images[0]?.url),
    similarity: item.similarity,
    overBudget: window !== null && item.priceKopecks > window.maxKopecks,
  }
}

/**
 * Пять товаров к предмету: сначала в ценовом окне, при недоборе добираем ближайшими без потолка
 * и помечаем их «выше бюджета». Считается на лету: каталог растёт, панель улучшается сама.
 */
export async function matchesForObject(
  object: ConceptObject,
  budgetKopecks: number | null,
): Promise<{ matches: MatchView[]; window: PriceWindow | null; styleOnly: boolean }> {
  const db = getDb()
  const window = priceWindow(budgetKopecks, object.category)
  // После перекраски ищем по вектору вырезки в новом цвете
  const embedding = object.editedEmbedding ?? object.embedding ?? []
  if (embedding.length === 0) {
    return { matches: [], window, styleOnly: false }
  }
  const inBudget = await findSimilar(db, {
    embedding,
    category: object.category,
    minPriceKopecks: window?.minKopecks,
    maxPriceKopecks: window?.maxKopecks,
    limit: MATCHES,
  })
  let items = inBudget
  if (inBudget.length < MIN_IN_BUDGET) {
    const extra = await findSimilar(db, {
      embedding,
      category: object.category,
      limit: MATCHES - inBudget.length,
      excludeIds: inBudget.map((item) => item.id),
    })
    items = [...inBudget, ...extra]
  }
  const matches = await Promise.all(items.map((item) => toMatch(item, window)))
  const best = matches[0]?.similarity ?? 0
  return { matches, window, styleOnly: matches.length > 0 && best < MATCH_CONFIDENCE_THRESHOLD }
}

export async function getConceptPage(userId: string, conceptId: string): Promise<ConceptPageData> {
  const db = getDb()
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId)).limit(1)
  if (!concept) {
    throw new NotFoundError('Концепт не найден')
  }
  // Проверка владельца идёт через комнату: чужой концепт неотличим от несуществующего
  const room = await getRoom(userId, concept.roomId)
  const [rows, byCatalogItem] = await Promise.all([
    db
      .select()
      .from(conceptObjects)
      .where(eq(conceptObjects.conceptId, concept.id))
      .orderBy(asc(conceptObjects.orderIndex)),
    shoppingQuantities(userId, room.projectId),
  ])

  const objects = await Promise.all(
    rows.map(async (object): Promise<ObjectView> => {
      const [{ matches, window, styleOnly }, maskSrc] = await Promise.all([
        matchesForObject(object, room.project.budgetKopecks),
        object.maskUrl ? presignedObjectUrl(object.maskUrl, 60 * 60) : Promise.resolve(null),
      ])
      return {
        id: object.id,
        orderIndex: object.orderIndex,
        category: object.category,
        label: object.label,
        bbox: object.bbox,
        maskSrc,
        maskKey: object.maskUrl,
        swatchId: object.swatchId,
        confidence: object.matchedConfidence,
        window,
        styleOnly,
        matches,
      }
    }),
  )

  return {
    role: room.role,
    concept: {
      id: concept.id,
      status: concept.status,
      objectsStatus: concept.objectsStatus,
      objectsError: concept.objectsError,
      liked: room.role === 'owner' ? concept.likedByOwner : concept.likedByPartner,
      renderSrc:
        (concept.editedRenderUrl ?? concept.renderUrl)
          ? await presignedObjectUrl(
              (concept.editedRenderUrl ?? concept.renderUrl) as string,
              60 * 60,
            )
          : null,
      renderKey: concept.renderUrl,
      editedRenderKey: concept.editedRenderUrl,
      note: concept.note,
      orderIndex: concept.orderIndex,
      batchId: concept.batchId,
    },
    room: {
      id: room.id,
      name: room.name,
      projectId: room.projectId,
      projectTitle: room.project.title,
      budgetKopecks: room.project.budgetKopecks,
    },
    objects,
    shopping: {
      byCatalogItem,
      count: Object.values(byCatalogItem).reduce((sum, quantity) => sum + quantity, 0),
    },
  }
}
