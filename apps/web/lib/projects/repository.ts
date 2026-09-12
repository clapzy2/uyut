import {
  concepts,
  type PlanReading,
  type Project,
  type ProjectRole,
  projectCollaborators,
  projects,
  type Room,
  type RoomCondition,
  type RoomKind,
  type RoomMeasurements,
  rooms,
  users,
} from '@uyut/db'
import { and, asc, count, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  assertOwner,
  assertOwnerOrCollaborator,
  isUuid,
  NotFoundError,
  type ProjectAccess,
  ProjectClosedError,
  requireOwner,
  roleOf,
} from './access'

// Все функции принимают userId первым аргументом: запросов «без владельца» здесь нет

export type ProjectListItem = Project & {
  roomCount: number
  role: ProjectRole
  /** Имя владельца для проектов, куда человека пригласили */
  ownerName: string | null
}

// Свои проекты и те, куда пригласили: у второго участника проект в том же списке
export async function listProjects(userId: string): Promise<ProjectListItem[]> {
  const rows = await getDb()
    .select({
      project: projects,
      roomCount: count(rooms.id),
      collaboratorRole: projectCollaborators.role,
      ownerName: users.displayName,
    })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(rooms, eq(rooms.projectId, projects.id))
    .leftJoin(
      projectCollaborators,
      and(eq(projectCollaborators.projectId, projects.id), eq(projectCollaborators.userId, userId)),
    )
    .where(
      and(
        isNull(projects.deletedAt),
        or(eq(projects.ownerId, userId), eq(projectCollaborators.userId, userId)),
      ),
    )
    .groupBy(projects.id, projectCollaborators.role, users.displayName)
    .orderBy(desc(projects.updatedAt))
  return rows.map((row) => ({
    ...row.project,
    roomCount: row.roomCount,
    role: row.project.ownerId === userId ? 'owner' : (row.collaboratorRole ?? 'partner'),
    ownerName: row.ownerName,
  }))
}

export async function createProject(userId: string, input: { title: string }): Promise<Project> {
  const [project] = await getDb()
    .insert(projects)
    .values({ ownerId: userId, title: input.title })
    .returning()
  if (!project) {
    throw new Error('project insert returned nothing')
  }
  return project
}

/** Комната со счётчиком готовых концептов: по нему на странице проекта видно, где уже работали */
export type RoomWithConcepts = Room & { conceptCount: number }

export type ProjectWithRooms = ProjectAccess & { rooms: RoomWithConcepts[] }

export async function getProject(userId: string, projectId: string): Promise<ProjectWithRooms> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  // Считаем только готовые: незавершённые и упавшие человеку показывать не за что
  const list = await getDb()
    .select({
      room: rooms,
      conceptCount: sql<number>`count(${concepts.id}) filter (where ${concepts.status} = 'ready')::int`,
    })
    .from(rooms)
    .leftJoin(concepts, eq(concepts.roomId, rooms.id))
    .where(eq(rooms.projectId, project.id))
    .groupBy(rooms.id)
    .orderBy(asc(rooms.orderIndex), asc(rooms.name))
  return {
    ...project,
    rooms: list.map((row) => ({ ...row.room, conceptCount: Number(row.conceptCount) })),
  }
}

export type ProjectPatch = {
  title?: string
  houseSeries?: string | null
  totalAreaM2?: number | null
}

export async function updateProject(
  userId: string,
  projectId: string,
  patch: ProjectPatch,
): Promise<Project> {
  const project = await assertOwner(userId, projectId)
  const [updated] = await getDb()
    .update(projects)
    .set(patch)
    .where(eq(projects.id, project.id))
    .returning()
  return updated ?? project
}

// Мягкое удаление: запись остаётся ради истории покупок, файлы вызывающий код удаляет из хранилища
export async function deleteProject(
  userId: string,
  projectId: string,
): Promise<{ fileKeys: string[] }> {
  const project = await getProject(userId, projectId)
  requireOwner(project.role)
  await getDb().update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id))
  const fileKeys = [
    project.planUrl,
    ...project.rooms.flatMap((room) => [room.photoUrl, room.planUrl]),
  ].filter((key): key is string => Boolean(key))
  return { fileKeys }
}

export async function setProjectPlan(
  userId: string,
  projectId: string,
  key: string,
): Promise<{ previousKey: string | null }> {
  const project = await assertOwner(userId, projectId)
  // Новый план — новые размеры: прочитанное со старого стирается, иначе человек подтвердит
  // чужие числа, глядя на свежую картинку.
  await getDb()
    .update(projects)
    .set({ planUrl: key, planReading: null })
    .where(eq(projects.id, project.id))
  return { previousKey: project.planUrl }
}

/**
 * Что прочитали с плана. Пишем и до правки, и после: по паре «прочитано» и «подтверждено»
 * потом видно, где чтение врёт, а другого способа это узнать у нас нет.
 */
export async function setPlanReading(
  userId: string,
  projectId: string,
  reading: PlanReading | null,
): Promise<void> {
  const project = await assertOwner(userId, projectId)
  await getDb().update(projects).set({ planReading: reading }).where(eq(projects.id, project.id))
}

/** Комнаты с плана одной пачкой: подтверждение — это один жест, а не пять. */
/**
 * Мерки комнаты после чтения плана: прочитанное поверх промеренного, но только там,
 * где прочитанное есть. План знает коробку комнаты и высоту потолка, участки стен знает
 * только рулетка, и одно не должно стирать другое.
 */
function mergeMeasurements(
  before: RoomMeasurements | null,
  read: RoomMeasurements | null,
): RoomMeasurements | null {
  const merged: RoomMeasurements = { ...(before ?? {}) }
  if (read?.ceilingCm !== undefined) {
    merged.ceilingCm = read.ceilingCm
  }
  if (read?.widthCm !== undefined) {
    merged.widthCm = read.widthCm
  }
  if (read?.depthCm !== undefined) {
    merged.depthCm = read.depthCm
  }
  return Object.keys(merged).length > 0 ? merged : null
}

export async function createRoomsFromPlan(
  userId: string,
  projectId: string,
  input: {
    rooms: Array<{
      /** Комната, которой достанутся числа. Пусто — заводим новую */
      roomId?: string
      condition: RoomCondition
      kind: RoomKind
      name: string
      areaM2: number | null
      measurements: RoomMeasurements | null
      notes: string | null
    }>
    reading: PlanReading
  },
): Promise<{ created: number; updated: number }> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  const [last] = await db
    .select({ maxIndex: max(rooms.orderIndex) })
    .from(rooms)
    .where(eq(rooms.projectId, project.id))
  let order = (last?.maxIndex ?? -1) + 1
  const wanted = input.rooms.filter((room) => room.roomId).map((room) => room.roomId as string)
  const current =
    wanted.length > 0
      ? await db
          .select()
          .from(rooms)
          .where(and(eq(rooms.projectId, project.id), inArray(rooms.id, wanted)))
      : []
  const byId = new Map(current.map((room) => [room.id, room]))
  // Комнату успели удалить между чтением плана и подтверждением: заводим заново, а не теряем
  const fresh = input.rooms.filter((room) => !room.roomId || !byId.has(room.roomId))
  const existing = input.rooms.filter((room) => room.roomId && byId.has(room.roomId))
  if (fresh.length > 0) {
    await db.insert(rooms).values(
      fresh.map((room) => ({
        projectId: project.id,
        condition: room.condition,
        kind: room.kind,
        name: room.name,
        areaM2: room.areaM2,
        measurements: room.measurements,
        notes: room.notes,
        orderIndex: order++,
      })),
    )
  }
  for (const room of existing) {
    const before = byId.get(room.roomId as string)
    if (!before) {
      continue
    }
    await db
      .update(rooms)
      .set({
        kind: room.kind,
        name: room.name,
        // Состояние комнаты не трогаем. Ответ на экране плана относится к новым комнатам:
        // у заведённой раньше человек мог выбрать «оставить как есть», и перезапись этого
        // ответа по умолчанию добавила бы в смету ремонт, которого никто не просил.
        // Площадь и мерки с плана дополняют, а не отменяют. Участки стен человек мерил
        // рулеткой, и с плана их не прочитать: затереть их прочитанным — потерять
        // единственные настоящие числа, какие у нас были.
        areaM2: room.areaM2 ?? before.areaM2,
        measurements: mergeMeasurements(before.measurements, room.measurements),
        // Заметку не затираем пустой: человек мог написать её раньше и оставить поле плана пустым
        ...(room.notes ? { notes: room.notes } : {}),
      })
      .where(and(eq(rooms.id, room.roomId as string), eq(rooms.projectId, project.id)))
  }
  await db
    .update(projects)
    .set({ planReading: input.reading, updatedAt: new Date() })
    .where(eq(projects.id, project.id))
  return { created: fresh.length, updated: existing.length }
}

export async function listRooms(userId: string, projectId: string): Promise<Room[]> {
  const project = await getProject(userId, projectId)
  return project.rooms
}

export async function createRoom(
  userId: string,
  projectId: string,
  input: { kind: RoomKind; name: string; areaM2?: number | null; condition?: RoomCondition },
): Promise<Room> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  const [last] = await db
    .select({ maxIndex: max(rooms.orderIndex) })
    .from(rooms)
    .where(eq(rooms.projectId, project.id))
  const [room] = await db
    .insert(rooms)
    .values({
      projectId: project.id,
      kind: input.kind,
      name: input.name,
      areaM2: input.areaM2 ?? null,
      ...(input.condition ? { condition: input.condition } : {}),
      orderIndex: (last?.maxIndex ?? -1) + 1,
    })
    .returning()
  if (!room) {
    throw new Error('room insert returned nothing')
  }
  await touchProject(project.id)
  return room
}

export type RoomWithProject = Room & { project: Project; role: ProjectRole }

export async function getRoom(userId: string, roomId: string): Promise<RoomWithProject> {
  if (!isUuid(roomId)) {
    throw new NotFoundError('Комната не найдена')
  }
  const [row] = await getDb()
    .select({ room: rooms, project: projects, collaborator: projectCollaborators })
    .from(rooms)
    .innerJoin(projects, eq(projects.id, rooms.projectId))
    .leftJoin(
      projectCollaborators,
      and(eq(projectCollaborators.projectId, projects.id), eq(projectCollaborators.userId, userId)),
    )
    .where(eq(rooms.id, roomId))
    .limit(1)
  const role = row ? roleOf(row.project, row.collaborator, userId) : null
  if (!row || !role) {
    throw new NotFoundError('Комната не найдена')
  }
  if (row.project.deletedAt) {
    if (role === 'partner') {
      throw new ProjectClosedError()
    }
    throw new NotFoundError('Комната не найдена')
  }
  return { ...row.room, project: row.project, role }
}

export type RoomPatch = {
  name?: string
  kind?: RoomKind
  areaM2?: number | null
  condition?: RoomCondition
  measurements?: RoomMeasurements | null
  notes?: string | null
  refreshFinish?: boolean
}

export async function updateRoom(userId: string, roomId: string, patch: RoomPatch): Promise<Room> {
  const room = await getRoom(userId, roomId)
  requireOwner(room.role)
  const [updated] = await getDb().update(rooms).set(patch).where(eq(rooms.id, room.id)).returning()
  await touchProject(room.projectId)
  return updated ?? room
}

export async function deleteRoom(userId: string, roomId: string): Promise<{ fileKeys: string[] }> {
  const room = await getRoom(userId, roomId)
  requireOwner(room.role)
  await getDb().delete(rooms).where(eq(rooms.id, room.id))
  await touchProject(room.projectId)
  return { fileKeys: [room.photoUrl, room.planUrl].filter((key): key is string => Boolean(key)) }
}

/** Отметка об идущей генерации: по ней страница восстанавливает ожидание после обновления */
export async function attachGenerationRun(
  roomId: string,
  runId: string,
  batchId: string,
): Promise<void> {
  await getDb()
    .update(rooms)
    .set({ generationRunId: runId, generationStartedAt: new Date(), generationBatchId: batchId })
    .where(eq(rooms.id, roomId))
}

/**
 * Занять комнату под генерацию, если она свободна. Возвращает false, когда её успели занять раньше.
 *
 * Отдельно от attachGenerationRun, потому что решает другую задачу: там мы записываем запуск,
 * который уже создан, а здесь ставим флаг ДО запуска, чтобы два нажатия подряд не оплатили
 * одну комнату дважды. Условие в WHERE делает проверку и захват одним запросом, и между ними
 * нельзя вклиниться.
 */
export async function claimRoomForGeneration(roomId: string, batchId: string): Promise<boolean> {
  const claimed = await getDb()
    .update(rooms)
    .set({ generationRunId: `pending:${batchId}`, generationStartedAt: new Date() })
    .where(and(eq(rooms.id, roomId), isNull(rooms.generationRunId)))
    .returning({ id: rooms.id })
  return claimed.length > 0
}

export async function clearGenerationRun(roomId: string): Promise<void> {
  await getDb()
    .update(rooms)
    .set({ generationRunId: null, generationStartedAt: null, generationBatchId: null })
    .where(eq(rooms.id, roomId))
}

export async function setRoomPhoto(
  userId: string,
  roomId: string,
  key: string,
): Promise<{ previousKey: string | null }> {
  const room = await getRoom(userId, roomId)
  requireOwner(room.role)
  await getDb().update(rooms).set({ photoUrl: key }).where(eq(rooms.id, room.id))
  await touchProject(room.projectId)
  return { previousKey: room.photoUrl }
}

// Список проектов сортируется по последнему изменению, включая правки комнат
async function touchProject(projectId: string): Promise<void> {
  await getDb().update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId))
}
