'use server'

import type { ChatMessage } from '@uyut/db'
import { requestConcepts } from '@/actions/concepts'
import { getChatMessage, listChatMessages, updateChatMeta } from '@/lib/chat/repository'
import { AccessError } from '@/lib/projects/access'
import { getSession } from '@/lib/session'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'

export type ChatHistoryItem = Pick<ChatMessage, 'id' | 'role' | 'content' | 'meta' | 'createdAt'>

export async function loadChatHistory(projectId: string): Promise<ActionResult<ChatHistoryItem[]>> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const rows = await listChatMessages(session.user.id, projectId)
    return {
      ok: true,
      data: rows.map(({ id, role, content, meta, createdAt }) => ({
        id,
        role,
        content,
        meta,
        createdAt,
      })),
    }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, error: error.message }
    }
    console.error(error)
    return { ok: false, error: GENERIC }
  }
}

/** Кнопка «Запустить» под предложением помощника: только здесь стартует платная генерация. */
export async function confirmRegeneration(
  messageId: string,
): Promise<ActionResult<{ runId: string; accessToken: string; roomId: string }>> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const message = await getChatMessage(session.user.id, messageId)
    const proposal = message.meta?.proposal
    if (proposal?.status !== 'pending') {
      return { ok: false, error: 'Это предложение уже обработано.' }
    }
    const run = await requestConcepts(
      proposal.roomId,
      proposal.conceptId
        ? {
            baseConceptId: proposal.conceptId,
            editRequest: proposal.summaryRu ?? proposal.revision,
          }
        : { revision: proposal.revision },
    )
    if (!run.ok) {
      return run
    }
    await updateChatMeta(message.id, {
      ...message.meta,
      proposal: { ...proposal, status: 'confirmed' },
    })
    return { ok: true, data: { ...run.data, roomId: proposal.roomId } }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, error: error.message }
    }
    console.error(error)
    return { ok: false, error: GENERIC }
  }
}

export async function dismissProposal(messageId: string): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const message = await getChatMessage(session.user.id, messageId)
    const proposal = message.meta?.proposal
    if (proposal && proposal.status === 'pending') {
      await updateChatMeta(message.id, {
        ...message.meta,
        proposal: { ...proposal, status: 'dismissed' },
      })
    }
    return { ok: true, data: undefined }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, error: error.message }
    }
    console.error(error)
    return { ok: false, error: GENERIC }
  }
}
