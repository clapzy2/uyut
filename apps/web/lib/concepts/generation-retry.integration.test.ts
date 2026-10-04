import { randomUUID } from 'node:crypto'
import { concepts, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import {
  attachGenerationRun,
  claimRoomForGeneration,
  createProject,
  createRoom,
  getRoom,
} from '@/lib/projects/repository'

const queue = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), token: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({
  runs: { retrieve: queue.retrieve, list: queue.list },
  auth: { createPublicToken: queue.token },
}))
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>()
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), TRIGGER_SECRET_KEY: 'test-no-network' }),
  }
})

import { generationStillRunning, resumeGenerationRun } from './resume-run'

describe('повтор после конечного отказа на отдельной БД, очередь подменена', () => {
  let owner = ''
  let projectId = ''

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    const localQa =
      databaseUrl.hostname === '127.0.0.1' &&
      databaseUrl.port === '58432' &&
      databaseUrl.pathname === '/domitsa_ui_qa'
    const isolatedCi =
      process.env.CI === 'true' &&
      databaseUrl.hostname === 'localhost' &&
      databaseUrl.port === '5432' &&
      databaseUrl.pathname === '/uyut'
    if (!localQa && !isolatedCi) {
      throw new Error('Разрешена только отдельная локальная QA-база или база CI')
    }

    const [user] = await getDb()
      .insert(users)
      .values({ email: `generation-retry-${randomUUID()}@example.test` })
      .returning()
    if (!user) throw new Error('Нет тестового пользователя')
    owner = user.id
    projectId = (await createProject(owner, { title: 'Локальный контроль повтора очереди' })).id
  })

  afterAll(async () => {
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })

  beforeEach(() => {
    vi.resetAllMocks()
    queue.token.mockResolvedValue('local-token')
  })

  it('FAILED сохраняет ready, освобождает комнату и пропускает только один повтор', async () => {
    const room = await createRoom(owner, projectId, { name: 'Гостиная', kind: 'living' })
    const failedBatch = randomUUID()
    expect(await claimRoomForGeneration(room.id, failedBatch)).toBe(true)
    await attachGenerationRun(room.id, 'run-failed', failedBatch)
    const oldRoomSnapshot = await getRoom(owner, room.id)
    const created = await getDb()
      .insert(concepts)
      .values(
        (['ready', 'pending'] as const).map((status, index) => ({
          roomId: room.id,
          batchId: failedBatch,
          orderIndex: index,
          prompt: 'Локальная проверка: генерация и сеть не вызываются',
          aiModel: 'test-no-generation',
          status,
          renderUrl: status === 'ready' ? 'qa/preserved-ready.webp' : null,
          likedByOwner: status === 'ready' ? true : null,
          objectsStatus: 'skipped' as const,
        })),
      )
      .returning()
    const readyBefore = created.find((concept) => concept.status === 'ready')
    expect(readyBefore).toBeDefined()

    queue.retrieve.mockResolvedValue({ status: 'FAILED' })
    expect(await generationStillRunning(oldRoomSnapshot)).toBe(false)
    const afterFailure = await getDb()
      .select()
      .from(concepts)
      .where(eq(concepts.batchId, failedBatch))
    expect(afterFailure.find((concept) => concept.id === readyBefore?.id)).toEqual(readyBefore)
    expect(afterFailure.find((concept) => concept.orderIndex === 1)?.status).toBe('failed')
    const released = await getRoom(owner, room.id)
    expect(released.generationRunId).toBeNull()
    expect(released.generationBatchId).toBeNull()
    expect(released.generationStartedAt).toBeNull()

    queue.retrieve.mockClear()
    expect(await generationStillRunning(released)).toBe(false)
    expect(queue.retrieve).not.toHaveBeenCalled()

    const retryBatches = Array.from({ length: 8 }, () => randomUUID())
    const claims = await Promise.all(
      retryBatches.map((batch) => claimRoomForGeneration(room.id, batch)),
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    const retryBatch = retryBatches[claims.indexOf(true)]
    if (!retryBatch) throw new Error('Нет единственной принятой брони повтора')
    await attachGenerationRun(room.id, 'run-retry', retryBatch)

    // Поздний ответ прежней проверки не снимает бронь нового запуска.
    expect(await generationStillRunning(oldRoomSnapshot)).toBe(false)
    const retryRoom = await getRoom(owner, room.id)
    expect(retryRoom.generationRunId).toBe('run-retry')
    expect(retryRoom.generationBatchId).toBe(retryBatch)
    queue.retrieve.mockResolvedValue({ status: 'EXECUTING' })
    expect(await resumeGenerationRun(retryRoom)).toEqual({
      runId: 'run-retry',
      accessToken: 'local-token',
    })
    expect(queue.list).not.toHaveBeenCalled()
    expect(await claimRoomForGeneration(room.id, randomUUID())).toBe(false)

    const afterRetry = await getDb().select().from(concepts).where(eq(concepts.roomId, room.id))
    expect(afterRetry).toHaveLength(2)
    expect(afterRetry.find((concept) => concept.id === readyBefore?.id)).toEqual(readyBefore)
  })
})
