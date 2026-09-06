import { type ChatMessage, type ChatMeta, type ChatRole, chatMessages } from '@uyut/db'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { assertOwnerOrCollaborator, NotFoundError } from '@/lib/projects/access'

export async function listChatMessages(
  userId: string,
  projectId: string,
  limit = 200,
): Promise<ChatMessage[]> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  return getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.projectId, project.id))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit)
}

export async function appendChatMessage(input: {
  projectId: string
  role: ChatRole
  content: string
  meta?: ChatMeta
}): Promise<ChatMessage> {
  const [row] = await getDb()
    .insert(chatMessages)
    .values({
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      meta: input.meta ?? null,
    })
    .returning()
  if (!row) {
    throw new Error('chat message insert returned nothing')
  }
  return row
}

export async function getChatMessage(userId: string, messageId: string): Promise<ChatMessage> {
  const [row] = await getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1)
  if (!row) {
    throw new NotFoundError('Сообщение не найдено')
  }
  await assertOwnerOrCollaborator(userId, row.projectId)
  return row
}

export async function updateChatMeta(messageId: string, meta: ChatMeta): Promise<void> {
  await getDb().update(chatMessages).set({ meta }).where(eq(chatMessages.id, messageId))
}
