'use server'

import { randomUUID } from 'node:crypto'
import { tasks, auth as triggerAuth } from '@trigger.dev/sdk'
import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import * as conceptsRepository from '@/lib/concepts/repository'
import { getEnv } from '@/lib/env'
import { NotFoundError } from '@/lib/projects/access'
import { getRoom } from '@/lib/projects/repository'
import { getConceptsByUserLimiter } from '@/lib/redis'
import { getSession } from '@/lib/session'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const NO_KEYS = 'Генерация пока не подключена: в настройках сервиса нет ключей.'

export type ConceptRun = { runId: string; accessToken: string; batchId: string }

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof NotFoundError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

export async function requestConcepts(
  roomId: string,
  revision?: string,
): Promise<ActionResult<ConceptRun>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const env = getEnv()
  if (!env.FAL_KEY || !env.TRIGGER_SECRET_KEY) {
    return { ok: false, error: NO_KEYS }
  }
  try {
    const room = await getRoom(userId, roomId)
    const { success } = await getConceptsByUserLimiter().limit(userId)
    if (!success) {
      return { ok: false, error: 'Сегодня уже много генераций. Попробуйте через час.' }
    }
    const batchId = randomUUID()
    const handle = await tasks.trigger('generate-concept', {
      roomId: room.id,
      batchId,
      count: 5,
      ...(revision ? { revision: revision.slice(0, 500) } : {}),
    })
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'room',
      targetId: room.id,
      metadata: { batchId, runId: handle.id },
    })
    const accessToken =
      handle.publicAccessToken ??
      (await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } }))
    return { ok: true, data: { runId: handle.id, accessToken, batchId } }
  } catch (error) {
    return failure(error)
  }
}

export async function setConceptLike(conceptId: string, liked: boolean): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const { roomId, projectId } = await conceptsRepository.setConceptLike(userId, conceptId, liked)
    revalidatePath(`/projects/${projectId}/rooms/${roomId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function refreshConcepts(roomId: string): Promise<ActionResult<{ pending: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const room = await getRoom(userId, roomId)
    const pending = await conceptsRepository.countPending(userId, room.id)
    revalidatePath(`/projects/${room.projectId}/rooms/${room.id}`)
    return { ok: true, data: { pending } }
  } catch (error) {
    return failure(error)
  }
}
