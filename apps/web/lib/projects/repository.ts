import { type Project, projects, type Room, type RoomKind, rooms } from '@uyut/db'
import { and, asc, count, desc, eq, isNull, max } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { assertOwnerOrCollaborator, isUuid, NotFoundError } from './access'

// Все функции принимают userId первым аргументом: запросов «без владельца» здесь нет

export type ProjectListItem = Project & { roomCount: number }

export async function listProjects(userId: string): Promise<ProjectListItem[]> {
  const rows = await getDb()
    .select({ project: projects, roomCount: count(rooms.id) })
    .from(projects)
    .leftJoin(rooms, eq(rooms.projectId, projects.id))
    .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)))
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt))
  return rows.map((row) => ({ ...row.project, roomCount: row.roomCount }))
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

export type ProjectWithRooms = Project & { rooms: Room[] }

export async function getProject(userId: string, projectId: string): Promise<ProjectWithRooms> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  const list = await getDb()
    .select()
    .from(rooms)
    .where(eq(rooms.projectId, project.id))
    .orderBy(asc(rooms.orderIndex), asc(rooms.name))
  return { ...project, rooms: list }
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
  const project = await assertOwnerOrCollaborator(userId, projectId)
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
  const project = await assertOwnerOrCollaborator(userId, projectId)
  await getDb().update(projects).set({ planUrl: key }).where(eq(projects.id, project.id))
  return { previousKey: project.planUrl }
}

export async function listRooms(userId: string, projectId: string): Promise<Room[]> {
  const project = await getProject(userId, projectId)
  return project.rooms
}

export async function createRoom(
  userId: string,
  projectId: string,
  input: { kind: RoomKind; name: string; areaM2?: number | null },
): Promise<Room> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
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
      orderIndex: (last?.maxIndex ?? -1) + 1,
    })
    .returning()
  if (!room) {
    throw new Error('room insert returned nothing')
  }
  await touchProject(project.id)
  return room
}

export type RoomWithProject = Room & { project: Project }

export async function getRoom(userId: string, roomId: string): Promise<RoomWithProject> {
  if (!isUuid(roomId)) {
    throw new NotFoundError('Комната не найдена')
  }
  const [row] = await getDb()
    .select({ room: rooms, project: projects })
    .from(rooms)
    .innerJoin(projects, eq(projects.id, rooms.projectId))
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (!row || row.project.ownerId !== userId || row.project.deletedAt) {
    throw new NotFoundError('Комната не найдена')
  }
  return { ...row.room, project: row.project }
}

export type RoomPatch = {
  name?: string
  kind?: RoomKind
  areaM2?: number | null
  notes?: string | null
  refreshFinish?: boolean
}

export async function updateRoom(userId: string, roomId: string, patch: RoomPatch): Promise<Room> {
  const room = await getRoom(userId, roomId)
  const [updated] = await getDb().update(rooms).set(patch).where(eq(rooms.id, room.id)).returning()
  await touchProject(room.projectId)
  return updated ?? room
}

export async function deleteRoom(userId: string, roomId: string): Promise<{ fileKeys: string[] }> {
  const room = await getRoom(userId, roomId)
  await getDb().delete(rooms).where(eq(rooms.id, room.id))
  await touchProject(room.projectId)
  return { fileKeys: [room.photoUrl, room.planUrl].filter((key): key is string => Boolean(key)) }
}

export async function setRoomPhoto(
  userId: string,
  roomId: string,
  key: string,
): Promise<{ previousKey: string | null }> {
  const room = await getRoom(userId, roomId)
  await getDb().update(rooms).set({ photoUrl: key }).where(eq(rooms.id, room.id))
  await touchProject(room.projectId)
  return { previousKey: room.photoUrl }
}

// Список проектов сортируется по последнему изменению, включая правки комнат
async function touchProject(projectId: string): Promise<void> {
  await getDb().update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId))
}
