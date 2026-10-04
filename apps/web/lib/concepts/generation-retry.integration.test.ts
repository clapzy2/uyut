import { randomUUID } from 'node:crypto'
import { auditLog, concepts, projectCollaborators, rooms, users } from '@uyut/db'
import { and, eq, inArray } from 'drizzle-orm'
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

import { finishGenerationRun, lastGenerationFailedBeforeCards } from './repository'
import { generationStillRunning, resumeGenerationRun } from './resume-run'

describe('повтор после конечного отказа на отдельной БД, очередь подменена', () => {
  let owner = ''
  let projectId = ''
  let partner = ''
  let outsider = ''

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
    const otherUsers = await getDb()
      .insert(users)
      .values([
        { email: `generation-partner-${randomUUID()}@example.test` },
        { email: `generation-outsider-${randomUUID()}@example.test` },
      ])
      .returning()
    partner = otherUsers[0]?.id ?? ''
    outsider = otherUsers[1]?.id ?? ''
    if (!partner || !outsider) throw new Error('Нет тестовых участников')
    await getDb()
      .insert(projectCollaborators)
      .values({ projectId, userId: partner, role: 'partner' })
  })

  afterAll(async () => {
    if (projectId) {
      const ownRooms = await getDb()
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.projectId, projectId))
      if (ownRooms.length)
        await getDb()
          .delete(auditLog)
          .where(
            and(
              eq(auditLog.action, 'concepts.finished'),
              eq(auditLog.targetType, 'room'),
              inArray(
                auditLog.targetId,
                ownRooms.map((room) => room.id),
              ),
            ),
          )
    }
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
    for (const id of [partner, outsider])
      if (id) await getDb().delete(users).where(eq(users.id, id))
  })

  it('сохраняет ранний отказ после обновления, не дублирует опрос и скрывает после успеха', async () => {
    const room = await createRoom(owner, projectId, { name: 'Спальня', kind: 'bedroom' })
    const batchId = randomUUID()
    await claimRoomForGeneration(room.id, batchId)
    await attachGenerationRun(room.id, 'run-early-failed', batchId)
    const old = await getRoom(owner, room.id)
    queue.retrieve.mockResolvedValue({ status: 'FAILED' })
    await Promise.all([generationStillRunning(old), generationStillRunning(old)])
    expect(await lastGenerationFailedBeforeCards(owner, room.id)).toBe(true)
    expect(await lastGenerationFailedBeforeCards(partner, room.id)).toBe(true)
    await expect(lastGenerationFailedBeforeCards(outsider, room.id)).rejects.toThrow(
      'Комната не найдена',
    )
    const events = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'concepts.finished'), eq(auditLog.targetId, room.id)))
    expect(events).toHaveLength(1)
    expect(events[0]?.actorId).toBeNull()
    expect(events[0]?.metadata).toEqual({ batchId, runId: 'run-early-failed', status: 'FAILED' })
    expect(await getDb().select().from(concepts).where(eq(concepts.roomId, room.id))).toHaveLength(
      0,
    )

    const next = randomUUID()
    expect(await claimRoomForGeneration(room.id, next)).toBe(true)
    await attachGenerationRun(room.id, 'run-next-completed', next)
    expect(await lastGenerationFailedBeforeCards(owner, room.id)).toBe(false)
    queue.retrieve.mockResolvedValueOnce({ status: 'COMPLETED' })
    await generationStillRunning(await getRoom(owner, room.id))
    expect(await lastGenerationFailedBeforeCards(owner, room.id)).toBe(false)
    // Поздний ответ первого запуска не возвращает устаревшую ошибку.
    await generationStillRunning(old)
    expect(await lastGenerationFailedBeforeCards(owner, room.id)).toBe(false)
    expect(
      await getDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'concepts.finished'), eq(auditLog.targetId, room.id))),
    ).toHaveLength(2)
    expect(queue.list).not.toHaveBeenCalled()
    expect(queue.token).not.toHaveBeenCalled()
  })

  it('отказ записи аудита откатывает очистку брони и pending-карточки', async () => {
    const room = await createRoom(owner, projectId, { name: 'Детская', kind: 'kid' })
    const batchId = randomUUID()
    await claimRoomForGeneration(room.id, batchId)
    await attachGenerationRun(room.id, 'run-audit-failure', batchId)
    await getDb().insert(concepts).values({
      roomId: room.id,
      batchId,
      orderIndex: 0,
      prompt: 'Нет платной генерации',
      aiModel: 'test',
      status: 'pending',
      objectsStatus: 'skipped',
    })
    const database = getDb()
    const transaction = database.transaction.bind(database)
    const injectedFailure = vi.spyOn(database, 'transaction').mockImplementationOnce((callback) =>
      transaction(async (tx) => {
        vi.spyOn(tx, 'insert').mockImplementation(() => {
          throw new Error('audit storage unavailable')
        })
        return callback(tx)
      }),
    )
    try {
      await expect(
        finishGenerationRun({
          roomId: room.id,
          runId: 'run-audit-failure',
          batchId,
          status: 'FAILED',
        }),
      ).rejects.toThrow('audit storage unavailable')
    } finally {
      injectedFailure.mockRestore()
    }
    expect((await getRoom(owner, room.id)).generationRunId).toBe('run-audit-failure')
    const [card] = await getDb().select().from(concepts).where(eq(concepts.batchId, batchId))
    expect(card?.status).toBe('pending')
    expect(
      await getDb().select().from(auditLog).where(eq(auditLog.targetId, room.id)),
    ).toHaveLength(0)
    await finishGenerationRun({
      roomId: room.id,
      runId: 'run-audit-failure',
      batchId,
      status: 'FAILED',
    })
    expect((await getRoom(owner, room.id)).generationRunId).toBeNull()
    expect(await lastGenerationFailedBeforeCards(owner, room.id)).toBe(false)
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
