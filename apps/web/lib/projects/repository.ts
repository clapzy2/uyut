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
import { and, asc, count, desc, eq, isNull, max, or, sql } from 'drizzle-orm'
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
export async function createRoomsFromPlan(
  userId: string,
  projectId: string,
  input: {
    rooms: Array<{
      kind: RoomKind
      name: string
      areaM2: number | null
      measurements: RoomMeasurements | null
    }>
    reading: PlanReading
  },
): Promise<Room[]> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  const [last] = await db
    .select({ maxIndex: max(rooms.orderIndex) })
    .from(rooms)
    .where(eq(rooms.projectId, project.id))
  let order = (last?.maxIndex ?? -1) + 1
  const created =
    input.rooms.length === 0
      ? []
      : await db
          .insert(rooms)
          .values(
            input.rooms.map((room) => ({
              projectId: project.id,
              kind: room.kind,
              name: room.name,
              areaM2: room.areaM2,
              measurements: room.measurements,
              orderIndex: order++,
            })),
          )
          .returning()
  await db
    .update(projects)
    .set({ planReading: input.reading, updatedAt: new Date() })
    .where(eq(projects.id, project.id))
  return created
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
