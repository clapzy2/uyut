import { randomUUID } from 'node:crypto'
import { auditLog, concepts, rooms, users } from '@uyut/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import {
  attachGenerationRun,
  claimRoomForGeneration,
  clearGenerationRun,
  createProject,
  createRoom,
  getProject,
  getRoom,
  setRoomPhoto,
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

import { listConceptsByRoom } from './repository'
import { generationStillRunning, resumeGenerationRun } from './resume-run'

describe('бронь генерации на настоящей локальной БД, очередь подменена', () => {
  let owner = ''
  let projectId = ''

  beforeAll(async () => {
    const [user] = await getDb()
      .insert(users)
      .values({ email: `generation-${randomUUID()}@example.test` })
      .returning()
    if (!user) throw new Error('Нет тестового пользователя')
    owner = user.id
    projectId = (await createProject(owner, { title: 'Локальный контроль запуска' })).id
  })
  afterAll(async () => {
    if (projectId) {
      const ownRooms = await getDb()
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.projectId, projectId))
      if (ownRooms.length) {
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
    }
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })
  beforeEach(() => {
    vi.resetAllMocks()
    queue.retrieve.mockResolvedValue({ status: 'EXECUTING' })
    queue.list.mockResolvedValue({ data: [{ id: 'run-recovered' }] })
    queue.token.mockResolvedValue('local-token')
  })

  async function fixture() {
    return createRoom(owner, projectId, { name: 'Гостиная', kind: 'living' })
  }

  it('из восьми одновременных запросов комнату занимает один', async () => {
    const room = await fixture()
    const batches = Array.from({ length: 8 }, () => randomUUID())
    const claims = await Promise.all(batches.map((batch) => claimRoomForGeneration(room.id, batch)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claimed = await getRoom(owner, room.id)
    expect(claimed.generationBatchId).toBe(batches[claims.indexOf(true)])
    expect(claimed.generationRunId).toBe(`pending:${claimed.generationBatchId}`)
  })

  it('не заменяет фото во время генерации', async () => {
    const room = await fixture()
    const batch = randomUUID()
    await claimRoomForGeneration(room.id, batch)

    await expect(setRoomPhoto(owner, room.id, 'new-photo.webp')).rejects.toThrow(
      'сейчас создаются варианты',
    )
    const saved = await getRoom(owner, room.id)
    expect(saved.photoUrl).toBeNull()
    expect(saved.photoRevision).toBe(0)
  })

  it('при двух одновременных заменах принимает только одну и увеличивает ревизию один раз', async () => {
    const room = await fixture()
    const results = await Promise.allSettled([
      setRoomPhoto(owner, room.id, 'first.webp'),
      setRoomPhoto(owner, room.id, 'second.webp'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const saved = await getRoom(owner, room.id)
    expect(['first.webp', 'second.webp']).toContain(saved.photoUrl)
    expect(saved.photoRevision).toBe(1)
  })

  it('сохраняет старые варианты, но для общего запуска считает только варианты по новому фото', async () => {
    const room = await fixture()
    await getDb().insert(concepts).values({
      roomId: room.id,
      batchId: randomUUID(),
      prompt: 'old',
      aiModel: 'test',
      status: 'ready',
      objectsStatus: 'skipped',
    })
    await setRoomPhoto(owner, room.id, 'new-photo.webp')

    const before = (await getProject(owner, projectId)).rooms.find((item) => item.id === room.id)
    expect(before?.conceptCount).toBe(1)
    expect(before?.currentConceptCount).toBe(0)

    await getDb().insert(concepts).values({
      roomId: room.id,
      batchId: randomUUID(),
      prompt: 'new',
      aiModel: 'test',
      status: 'ready',
      objectsStatus: 'skipped',
      sourcePhotoRevision: 1,
    })
    const after = (await getProject(owner, projectId)).rooms.find((item) => item.id === room.id)
    expect(after?.conceptCount).toBe(2)
    expect(after?.currentConceptCount).toBe(1)
  })

  it('поздний ответ прежнего запуска и его очистка не меняют новую бронь', async () => {
    const room = await fixture()
    const first = randomUUID()
    const next = randomUUID()
    await claimRoomForGeneration(room.id, first)
    await attachGenerationRun(room.id, 'run-old', first)
    await clearGenerationRun(room.id, 'run-old')
    await claimRoomForGeneration(room.id, next)
    await attachGenerationRun(room.id, 'run-old', first)
    await clearGenerationRun(room.id, 'run-old')
    const current = await getRoom(owner, room.id)
    expect(current.generationRunId).toBe(`pending:${next}`)
    expect(current.generationBatchId).toBe(next)
  })

  it('восстановление записывает найденный запуск без повторной генерации', async () => {
    const room = await fixture()
    const batch = randomUUID()
    await claimRoomForGeneration(room.id, batch)
    expect(await resumeGenerationRun(await getRoom(owner, room.id))).toEqual({
      runId: 'run-recovered',
      accessToken: 'local-token',
    })
    expect((await getRoom(owner, room.id)).generationRunId).toBe('run-recovered')
  })

  it('активная старая пачка не объявляется ошибкой по возрасту карточек', async () => {
    const room = await fixture()
    const batch = randomUUID()
    await claimRoomForGeneration(room.id, batch)
    await attachGenerationRun(room.id, 'run-active', batch)
    const [concept] = await getDb()
      .insert(concepts)
      .values({
        roomId: room.id,
        batchId: batch,
        orderIndex: 0,
        prompt: 'local',
        aiModel: 'test',
        status: 'pending',
        createdAt: new Date(Date.now() - 60 * 60_000),
        objectsStatus: 'skipped',
      })
      .returning()
    const listed = await listConceptsByRoom(owner, room.id)
    expect(listed.find((item) => item.id === concept?.id)?.status).toBe('pending')
    expect(await generationStillRunning(await getRoom(owner, room.id))).toBe(true)
  })

  it('конечный сбой закрывает незавершённые карточки, но сохраняет готовые', async () => {
    const room = await fixture()
    const batch = randomUUID()
    await claimRoomForGeneration(room.id, batch)
    await attachGenerationRun(room.id, 'run-failed', batch)
    await getDb()
      .insert(concepts)
      .values(
        ['ready', 'pending'].map((status, index) => ({
          roomId: room.id,
          batchId: batch,
          orderIndex: index,
          prompt: 'local',
          aiModel: 'test',
          status: status as 'ready' | 'pending',
          objectsStatus: 'skipped' as const,
        })),
      )
    queue.retrieve.mockResolvedValueOnce({ status: 'CRASHED' })
    expect(await generationStillRunning(await getRoom(owner, room.id))).toBe(false)
    const saved = await getDb().select().from(concepts).where(eq(concepts.batchId, batch))
    expect(saved.find((item) => item.orderIndex === 0)?.status).toBe('ready')
    expect(saved.find((item) => item.orderIndex === 1)?.status).toBe('failed')
    expect((await getRoom(owner, room.id)).generationRunId).toBeNull()
    expect(await claimRoomForGeneration(room.id, randomUUID())).toBe(true)
  })

  it('сетевой сбой при проверке не снимает бронь даже после часа ожидания', async () => {
    const room = await fixture()
    const batch = randomUUID()
    await claimRoomForGeneration(room.id, batch)
    await getDb()
      .update(rooms)
      .set({ generationStartedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(rooms.id, room.id))
    queue.list.mockRejectedValueOnce(new Error('offline'))
    expect(await resumeGenerationRun(await getRoom(owner, room.id))).toBeNull()
    expect((await getRoom(owner, room.id)).generationRunId).toBe(`pending:${batch}`)
    expect(await claimRoomForGeneration(room.id, randomUUID())).toBe(false)
  })
})
