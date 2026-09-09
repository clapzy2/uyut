import type { PromptPlan } from '@uyut/ai'
import { type Concept, concepts, rooms } from '@uyut/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { getRoom, type RoomWithProject } from '@/lib/projects/repository'
import { CONCEPT_STALE_AFTER_MS, OBJECTS_STALE_AFTER_MS, staleBefore } from '@/lib/queue/stale'
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

const RENDER_LOST = 'Рендер не досчитался: задача пропала. Попробуйте сгенерировать ещё раз.'
const OBJECTS_LOST = 'Предметы на этом рендере найти не удалось.'

/**
 * Гасит работу, которую задачи так и не досчитали.
 *
 * Делается при чтении, а не отдельным расписанием: экран всё равно перечитывает список,
 * и лишняя фоновая задача ради этого не нужна. Но пишем только когда есть что гасить —
 * иначе каждый просмотр комнаты, а их на одну генерацию десятки, стоил бы двух запросов
 * на запись. Условие по статусу дублируется в самом update: строка, дописавшаяся между
 * чтением и записью, не пострадает.
 *
 * Рендер и подбор предметов гасятся порознь: это разные задачи с разными сроками, и рендер
 * бывает готов при намертво зависшем подборе — тогда карточка вечно показывает «ищем предметы».
 */
async function failStale(rows: Concept[], now: Date): Promise<Concept[]> {
  const lostRenders = rows.filter(
    (row) => row.status === 'pending' && row.createdAt < staleBefore(now, CONCEPT_STALE_AFTER_MS),
  )
  const lostObjects = rows.filter(
    (row) =>
      row.objectsStatus === 'pending' && row.createdAt < staleBefore(now, OBJECTS_STALE_AFTER_MS),
  )
  if (lostRenders.length === 0 && lostObjects.length === 0) {
    return rows
  }
  const db = getDb()
  if (lostRenders.length > 0) {
    await db
      .update(concepts)
      .set({ status: 'failed', errorText: RENDER_LOST })
      .where(
        and(
          inArray(
            concepts.id,
            lostRenders.map((row) => row.id),
          ),
          eq(concepts.status, 'pending'),
        ),
      )
  }
  if (lostObjects.length > 0) {
    await db
      .update(concepts)
      .set({ objectsStatus: 'failed', objectsError: OBJECTS_LOST })
      .where(
        and(
          inArray(
            concepts.id,
            lostObjects.map((row) => row.id),
          ),
          eq(concepts.objectsStatus, 'pending'),
        ),
      )
  }
  const renderIds = new Set(lostRenders.map((row) => row.id))
  const objectIds = new Set(lostObjects.map((row) => row.id))
  return rows.map((row) => ({
    ...row,
    ...(renderIds.has(row.id) ? { status: 'failed' as const, errorText: RENDER_LOST } : {}),
    ...(objectIds.has(row.id)
      ? { objectsStatus: 'failed' as const, objectsError: OBJECTS_LOST }
      : {}),
  }))
}

export async function listConceptsByRoom(userId: string, roomId: string): Promise<ConceptView[]> {
  const room = await getRoom(userId, roomId)
  const rows = await getDb()
    .select()
    .from(concepts)
    .where(eq(concepts.roomId, room.id))
    .orderBy(desc(concepts.createdAt), asc(concepts.orderIndex))
  return withSignedUrls(await failStale(rows, new Date()))
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
  await getDb()
    .update(concepts)
    .set(room.role === 'owner' ? { likedByOwner: liked } : { likedByPartner: liked })
    .where(eq(concepts.id, row.id))
  return { roomId: room.id, projectId: room.projectId }
}

export type RoomLikes = Record<string, { owner: boolean | null; partner: boolean | null }>

/** Отметки обоих по комнате: доступ к проекту вызывающий код уже проверил */
export async function roomLikes(projectId: string, roomId: string): Promise<RoomLikes> {
  const rows = await getDb()
    .select({
      id: concepts.id,
      owner: concepts.likedByOwner,
      partner: concepts.likedByPartner,
      projectId: rooms.projectId,
    })
    .from(concepts)
    .innerJoin(rooms, eq(rooms.id, concepts.roomId))
    .where(and(eq(concepts.roomId, roomId), eq(rooms.projectId, projectId)))
  const likes: RoomLikes = {}
  for (const row of rows) {
    likes[row.id] = { owner: row.owner, partner: row.partner }
  }
  return likes
}

/**
 * Сколько концептов у запуска и сколько из них ещё в работе. Считается по самому запуску,
 * без проверки прав: зовётся только рядом с уже проверенной комнатой.
 */
export async function countBatch(batchId: string): Promise<{ total: number; pending: number }> {
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${concepts.status} = 'pending')::int`,
    })
    .from(concepts)
    .where(eq(concepts.batchId, batchId))
  return { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0) }
}

export async function countPending(userId: string, roomId: string): Promise<number> {
  const { items } = await latestBatch(userId, roomId)
  return items.filter((item) => item.status === 'pending').length
}
