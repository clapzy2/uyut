import { type Project, type ProjectRole, projectCollaborators, projects } from '@uyut/db'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Общий предок ошибок доступа: экшены отдают их текст пользователю как есть
export class AccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessError'
  }
}

export class NotFoundError extends AccessError {
  constructor(message = 'Не найдено') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class OwnerOnlyError extends AccessError {
  constructor(message = 'Это может сделать только владелец проекта.') {
    super(message)
    this.name = 'OwnerOnlyError'
  }
}

// Владелец удалил проект, в котором второй участник уже был: ему честная страница, а не 404
export class ProjectClosedError extends AccessError {
  constructor(message = 'Владелец закрыл проект.') {
    super(message)
    this.name = 'ProjectClosedError'
  }
}

export type ProjectAccess = Project & { role: ProjectRole }

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

export function requireOwner(role: ProjectRole): void {
  if (role !== 'owner') {
    throw new OwnerOnlyError()
  }
}

export function roleOf(
  project: Pick<Project, 'ownerId'>,
  collaborator: Pick<{ userId: string; role: ProjectRole }, 'userId' | 'role'> | null,
  userId: string,
): ProjectRole | null {
  if (project.ownerId === userId) {
    return 'owner'
  }
  return collaborator?.userId === userId ? collaborator.role : null
}

/** Чужой проект неотличим от несуществующего: никаких «доступ запрещён». */
export async function assertOwnerOrCollaborator(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  if (!isUuid(projectId)) {
    throw new NotFoundError('Проект не найден')
  }
  const [row] = await getDb()
    .select({ project: projects, collaborator: projectCollaborators })
    .from(projects)
    .leftJoin(
      projectCollaborators,
      and(eq(projectCollaborators.projectId, projects.id), eq(projectCollaborators.userId, userId)),
    )
    .where(eq(projects.id, projectId))
    .limit(1)
  const role = row ? roleOf(row.project, row.collaborator, userId) : null
  if (!row || !role) {
    throw new NotFoundError('Проект не найден')
  }
  if (row.project.deletedAt) {
    if (role === 'partner') {
      throw new ProjectClosedError()
    }
    throw new NotFoundError('Проект не найден')
  }
  return { ...row.project, role }
}

/** Действия, которые тратят деньги или меняют проект: только владелец */
export async function assertOwner(userId: string, projectId: string): Promise<ProjectAccess> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  requireOwner(project.role)
  return project
}
