import { runs, auth as triggerAuth } from '@trigger.dev/sdk'
import type { Room } from '@uyut/db'
import { getEnv } from '@/lib/env'
import { attachGenerationRun } from '@/lib/projects/repository'
import { isTerminalRunStatus } from '@/lib/queue/run-status'
import { finishGenerationRun } from './repository'

export type ConceptRunHandle = { runId: string; accessToken: string }
export type ConceptRunProgress = {
  stage?: string
  done?: number
  total?: number
  failed?: number
}

const QUEUE_TIMEOUT_MS = 4_000

export class GenerationStatusUnknownError extends Error {
  constructor() {
    super('Статус запуска пока не подтверждён. Проверьте его позже; новый запуск не отправлен.')
  }
}

export function generationRunTag(batchId: string): string {
  return `concept-batch:${batchId}`
}

export function isPendingClaim(runId: string | null): boolean {
  return runId?.startsWith('pending:') ?? false
}

async function queueResponse<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new GenerationStatusUnknownError()), QUEUE_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ни возраст отметки, ни отсутствие первых картинок не доказывают окончание задачи.
 * Очередь может ждать воркер дольше времени выполнения. Освобождаем комнату только
 * после конечного статуса; при потере ответа ищем уже отправленный запуск по метке.
 */
async function currentGeneration(
  room: Room,
): Promise<{ runId: string; running: boolean; progress: ConceptRunProgress } | null> {
  if (!room.generationRunId) return null
  if (!getEnv().TRIGGER_SECRET_KEY) throw new GenerationStatusUnknownError()

  let runId = room.generationRunId
  const batchId =
    room.generationBatchId ?? (isPendingClaim(runId) ? runId.slice('pending:'.length) : null)
  if (isPendingClaim(runId)) {
    if (!batchId) throw new GenerationStatusUnknownError()
    const page = await queueResponse(
      runs.list(
        { taskIdentifier: 'generate-concept', tag: generationRunTag(batchId), limit: 2 },
        { retry: { maxAttempts: 1 } },
      ),
    )
    const [found] = page.data
    // Пустой ответ не доказывает отказ: исходный запрос ещё мог не завершиться.
    if (!found || page.data.length !== 1) throw new GenerationStatusUnknownError()
    runId = found.id
    await attachGenerationRun(room.id, runId, batchId)
  }

  const run = await queueResponse(runs.retrieve(runId, { retry: { maxAttempts: 1 } }))
  const running = !isTerminalRunStatus(run.status)
  if (!running) {
    // Воркер мог упасть после создания pending-карточек. Они не должны навсегда
    // блокировать повтор; готовые изображения и товары этой пачки сохраняются.
    await finishGenerationRun({ roomId: room.id, runId, batchId, status: run.status })
  }
  return {
    runId,
    running,
    progress: (run.metadata?.progress ?? {}) as ConceptRunProgress,
  }
}

export async function generationStillRunning(room: Room): Promise<boolean> {
  return (await currentGeneration(room))?.running ?? false
}

export async function generationStatus(
  room: Room,
): Promise<{ running: boolean; progress: ConceptRunProgress }> {
  const run = await currentGeneration(room)
  return run ? { running: run.running, progress: run.progress } : { running: false, progress: {} }
}

/** Восстанавливает ожидание без нового вызова генерации и не роняет страницу при сбое очереди. */
export async function resumeGenerationRun(room: Room): Promise<ConceptRunHandle | null> {
  try {
    const run = await currentGeneration(room)
    if (!run?.running) return null
    const accessToken = await queueResponse(
      triggerAuth.createPublicToken({ scopes: { read: { runs: [run.runId] } } }),
    )
    return { runId: run.runId, accessToken }
  } catch (error) {
    console.error('resume generation run', error)
    return null
  }
}
