import type { Room } from '@uyut/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  retrieve: vi.fn(),
  token: vi.fn(),
  attach: vi.fn(),
  clear: vi.fn(),
  fail: vi.fn(),
}))
vi.mock('@trigger.dev/sdk', () => ({
  runs: { list: mocks.list, retrieve: mocks.retrieve },
  auth: { createPublicToken: mocks.token },
}))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ TRIGGER_SECRET_KEY: 'test' }) }))
vi.mock('@/lib/projects/repository', () => ({
  attachGenerationRun: mocks.attach,
  clearGenerationRun: mocks.clear,
}))
vi.mock('./repository', () => ({ failPendingBatch: mocks.fail }))

import {
  GenerationStatusUnknownError,
  generationStillRunning,
  resumeGenerationRun,
} from './resume-run'

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    generationRunId: 'run-1',
    generationBatchId: 'batch-1',
    generationStartedAt: new Date(Date.now() - 60 * 60_000),
    ...overrides,
  } as Room
}

describe('возвращение к генерации без повторного запуска', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.retrieve.mockResolvedValue({ id: 'run-1', status: 'EXECUTING' })
    mocks.token.mockResolvedValue('token-1')
    mocks.list.mockResolvedValue({ data: [{ id: 'run-1' }] })
  })
  afterEach(() => vi.useRealTimers())

  it.each(['QUEUED', 'PENDING_VERSION', 'EXECUTING', 'WAITING'])(
    'не снимает старую бронь при статусе %s',
    async (status) => {
      mocks.retrieve.mockResolvedValue({ status })
      expect(await generationStillRunning(room())).toBe(true)
      expect(mocks.clear).not.toHaveBeenCalled()
    },
  )

  it.each(['COMPLETED', 'FAILED', 'CANCELED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT'])(
    'снимает только завершённый запуск: %s',
    async (status) => {
      mocks.retrieve.mockResolvedValue({ status })
      expect(await generationStillRunning(room())).toBe(false)
      expect(mocks.fail).toHaveBeenCalledExactlyOnceWith('batch-1')
      expect(mocks.clear).toHaveBeenCalledExactlyOnceWith('room-1', 'run-1')
    },
  )

  it('восстанавливает принятый запуск по точной метке после потери ответа', async () => {
    expect(await resumeGenerationRun(room({ generationRunId: 'pending:batch-1' }))).toEqual({
      runId: 'run-1',
      accessToken: 'token-1',
    })
    expect(mocks.list).toHaveBeenCalledWith(
      { taskIdentifier: 'generate-concept', tag: 'concept-batch:batch-1', limit: 2 },
      { retry: { maxAttempts: 1 } },
    )
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith('room-1', 'run-1', 'batch-1')
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('не считает пустую очередь доказанным отказом старого pending-запроса', async () => {
    mocks.list.mockResolvedValue({ data: [] })
    await expect(
      generationStillRunning(room({ generationRunId: 'pending:batch-1' })),
    ).rejects.toBeInstanceOf(GenerationStatusUnknownError)
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('не выбирает произвольно один запуск, если метка неожиданно повторилась', async () => {
    mocks.list.mockResolvedValue({ data: [{ id: 'run-1' }, { id: 'run-2' }] })
    await expect(
      generationStillRunning(room({ generationRunId: 'pending:batch-1' })),
    ).rejects.toBeInstanceOf(GenerationStatusUnknownError)
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('отсутствие активного запуска не вызывает сеть', async () => {
    expect(await generationStillRunning(room({ generationRunId: null }))).toBe(false)
    expect(mocks.retrieve).not.toHaveBeenCalled()
  })

  it('сбой выдачи токена не снимает принятую задачу и не роняет страницу', async () => {
    mocks.token.mockRejectedValueOnce(new Error('offline'))
    expect(await resumeGenerationRun(room())).toBeNull()
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('проверка очереди ограничена четырьмя секундами без освобождения комнаты', async () => {
    vi.useFakeTimers()
    mocks.retrieve.mockReturnValue(new Promise(() => {}))
    const result = resumeGenerationRun(room())
    await vi.advanceTimersByTimeAsync(4_000)
    expect(await result).toBeNull()
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
