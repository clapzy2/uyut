import type { PromptPlan } from '@uyut/ai'
import { type Concept, concepts } from '@uyut/db'
import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { getRoom, type RoomWithProject } from '@/lib/projects/repository'
import { presignedObjectUrl } from '@/lib/storage'

export type ConceptView = Concept & { renderSrc: string | null }

async function withSignedUrls(rows: Concept[]): Promise<ConceptView[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      renderSrc:
        (row.editedRenderUrl ?? row.renderUrl)
          ? await presignedObjectUrl((row.editedRenderUrl ?? row.renderUrl) as string, 60 * 60)
          : null,
    })),
  )
}

export async function listConceptsByRoom(userId: string, roomId: string): Promise<ConceptView[]> {
  const room = await getRoom(userId, roomId)
  const rows = await getDb()
    .select()
    .from(concepts)
    .where(eq(concepts.roomId, room.id))
    .orderBy(desc(concepts.createdAt), asc(concepts.orderIndex))
  return withSignedUrls(rows)
}

/** Концепты последнего запуска: именно их показывает экран свайпа. */
export async function latestBatch(
  userId: string,
  roomId: string,
): Promise<{ batchId: string | null; items: ConceptView[] }> {
  const all = await listConceptsByRoom(userId, roomId)
  const batchId = all[0]?.batchId ?? null
  if (!batchId) {
    return { batchId: null, items: [] }
  }
  const items = all
    .filter((item) => item.batchId === batchId)
    .sort((left, right) => left.orderIndex - right.orderIndex)
  return { batchId, items }
}

export async function likedConcepts(userId: string, roomId: string): Promise<ConceptView[]> {
  const room = await getRoom(userId, roomId)
  const rows = await getDb()
    .select()
    .from(concepts)
    .where(and(eq(concepts.roomId, room.id), eq(concepts.likedByOwner, true)))
    .orderBy(desc(concepts.createdAt))
  return withSignedUrls(rows)
}

/**
 * Строки создаются до рендера: пользователь сразу видит пять карточек «в работе»,
 * а задача Trigger.dev дозаполняет их по мере готовности.
 */
export async function createBatch(input: {
  room: RoomWithProject
  batchId: string
  plan: PromptPlan
  model: string
  styleTags: string[]
}): Promise<Concept[]> {
  const rows = input.plan.variations.map((variation, index) => ({
    roomId: input.room.id,
    batchId: input.batchId,
    orderIndex: index,
    status: 'pending' as const,
    prompt: `${input.plan.shared} ${variation}`.trim(),
    styleTags: input.styleTags,
    aiModel: input.model,
  }))
  return getDb().insert(concepts).values(rows).returning()
}

export async function setConceptLike(
  userId: string,
  conceptId: string,
  liked: boolean | null,
): Promise<{ roomId: string; projectId: string }> {
  const [row] = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1)
  if (!row) {
    throw new NotFoundError('Концепт не найден')
  }
  // Проверка владельца идёт через комнату: чужой концепт неотличим от несуществующего
  const room = await getRoom(userId, row.roomId)
  await getDb().update(concepts).set({ likedByOwner: liked }).where(eq(concepts.id, row.id))
  return { roomId: room.id, projectId: room.projectId }
}

export async function countPending(userId: string, roomId: string): Promise<number> {
  const { items } = await latestBatch(userId, roomId)
  return items.filter((item) => item.status === 'pending').length
}
