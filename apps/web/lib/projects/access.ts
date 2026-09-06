import { type Project, projects } from '@uyut/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class NotFoundError extends Error {
  constructor(message = 'Не найдено') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

// Чужой проект неотличим от несуществующего: никаких «доступ запрещён».
// Партнёры по проекту добавятся сюда в фазе коллаборации.
export async function assertOwnerOrCollaborator(
  userId: string,
  projectId: string,
): Promise<Project> {
  if (!isUuid(projectId)) {
    throw new NotFoundError('Проект не найден')
  }
  const [project] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1)
  if (!project || project.ownerId !== userId) {
    throw new NotFoundError('Проект не найден')
  }
  return project
}
