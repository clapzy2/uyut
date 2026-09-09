import { auth as triggerAuth } from '@trigger.dev/sdk'
import type { Room } from '@uyut/db'
import { getEnv } from '@/lib/env'
import { clearGenerationRun } from '@/lib/projects/repository'
import { countBatch } from './repository'

export type ConceptRunHandle = { runId: string; accessToken: string }

/**
 * Генерация живёт дольше, чем открытая вкладка: человек обновляет страницу, уходит и
 * возвращается. Отметка о прогоне лежит у комнаты, и по ней ожидание продолжается.
 *
 * Окно в четверть часа — с запасом: задача живёт не дольше десяти минут. Если отметка
 * старше, значит её забыли снять, и показывать ожидание уже незачем.
 */
const STALE_AFTER_MS = 15 * 60_000
// Очередь живёт за границей и отвечает не всегда быстро, а страница комнаты ждать не должна:
// без ключа она просто откроется без экрана ожидания
const TOKEN_TIMEOUT_MS = 4_000

/**
 * Идёт ли генерация на самом деле.
 *
 * Одной отметки мало. Её снимает страница, когда панель поймёт, что задача кончилась, а панель
 * узнаёт это по живому потоку из очереди — и поток умеет замолчать. Тогда отметка висит, и
 * ожидание показывалось бы поверх давно готовых концептов; так и случилось на первом же прогоне.
 *
 * Поэтому спрашиваем сами концепты этого запуска: пока ни один не создан, ждём — задача ещё
 * не дошла до их создания. Как только они есть и ни один не в работе, ждать нечего.
 */
export async function generationStillRunning(room: Room): Promise<boolean> {
  const startedAt = room.generationStartedAt
  if (!room.generationRunId || !startedAt) {
    return false
  }
  if (Date.now() - startedAt.getTime() > STALE_AFTER_MS) {
    return false
  }
  if (!room.generationBatchId) {
    // Прогон начат до того, как мы стали запоминать запуск: полагаемся на срок
    return true
  }
  const batch = await countBatch(room.generationBatchId)
  return batch.total === 0 || batch.pending > 0
}

/** Ключ для продолжения ожидания, если генерация и правда идёт. */
export async function resumeGenerationRun(room: Room): Promise<ConceptRunHandle | null> {
  const runId = room.generationRunId
  if (!runId || !getEnv().TRIGGER_SECRET_KEY) {
    return null
  }
  if (!(await generationStillRunning(room))) {
    await clearGenerationRun(room.id)
    return null
  }
  try {
    const accessToken = await Promise.race([
      triggerAuth.createPublicToken({ scopes: { read: { runs: [runId] } } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('очередь не ответила')), TOKEN_TIMEOUT_MS),
      ),
    ])
    return { runId, accessToken }
  } catch (error) {
    // Очередь недоступна — не повод ронять страницу комнаты: покажем её без ожидания
    console.error('resume generation run', error)
    return null
  }
}
