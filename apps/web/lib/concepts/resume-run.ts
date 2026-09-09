import { auth as triggerAuth } from '@trigger.dev/sdk'
import type { Room } from '@uyut/db'
import { getEnv } from '@/lib/env'

export type ConceptRunHandle = { runId: string; accessToken: string }

/**
 * Генерация живёт дольше, чем открытая вкладка: человек обновляет страницу, уходит и
 * возвращается. Отметка о прогоне лежит у комнаты, и здесь по ней выписывается свежий
 * читающий ключ, чтобы экран ожидания продолжился с того же места.
 *
 * Окно в четверть часа — с запасом: задача живёт не дольше десяти минут. Если отметка
 * старше, значит её забыли снять, и показывать ожидание уже незачем.
 */
const STALE_AFTER_MS = 15 * 60_000

export async function resumeGenerationRun(room: Room): Promise<ConceptRunHandle | null> {
  const runId = room.generationRunId
  const startedAt = room.generationStartedAt
  if (!runId || !startedAt || !getEnv().TRIGGER_SECRET_KEY) {
    return null
  }
  if (Date.now() - startedAt.getTime() > STALE_AFTER_MS) {
    return null
  }
  try {
    const accessToken = await triggerAuth.createPublicToken({
      scopes: { read: { runs: [runId] } },
    })
    return { runId, accessToken }
  } catch (error) {
    // Очередь недоступна — не повод ронять страницу комнаты: покажем её без ожидания
    console.error('resume generation run', error)
    return null
  }
}
