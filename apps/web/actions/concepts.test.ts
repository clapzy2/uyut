import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  audit: vi.fn(),
  claim: vi.fn(),
  clear: vi.fn(),
  getRoom: vi.fn(),
  getProject: vi.fn(),
  apartmentPlan: vi.fn(),
  duoOffer: vi.fn(),
  pending: vi.fn(),
  running: vi.fn(),
  limit: vi.fn(),
  token: vi.fn(),
  trigger: vi.fn(),
  editConcept: vi.fn(),
  buildPlan: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trigger.dev/sdk')>()),
  auth: { createPublicToken: mocks.token },
  tasks: { trigger: mocks.trigger },
}))
vi.mock('@uyut/ai', () => ({ buildEditPlan: mocks.buildPlan }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/collaboration/live', () => ({
  bumpProjectVersion: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/concepts/apartment', () => ({
  APARTMENT_COUNT: 3,
  apartmentPlan: mocks.apartmentPlan,
}))
vi.mock('@/lib/concepts/duo', () => ({ getDuoOffer: mocks.duoOffer }))
vi.mock('@/lib/concepts/repository', () => ({
  countPending: mocks.pending,
  getConceptForEdit: mocks.editConcept,
}))
vi.mock('@/lib/concepts/resume-run', () => ({
  generationStillRunning: mocks.running,
  generationRunTag: (id: string) => `concept-batch:${id}`,
  GenerationStatusUnknownError: class extends Error {
    constructor() {
      super('Статус запуска пока не подтверждён.')
    }
  },
}))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    FAL_KEY: 'test',
    TRIGGER_SECRET_KEY: 'test',
    BETTER_AUTH_SECRET: 'test-secret-for-edit-plans',
  }),
}))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  requireOwner: vi.fn(),
}))
vi.mock('@/lib/projects/repository', () => ({
  attachGenerationRun: mocks.attach,
  claimRoomForGeneration: mocks.claim,
  clearGenerationRun: mocks.clear,
  getProject: mocks.getProject,
  getRoom: mocks.getRoom,
}))
vi.mock('@/lib/redis', () => ({
  getConceptsByUserLimiter: () => ({ limit: mocks.limit }),
}))
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ user: { id: 'user-1' } }),
}))

import { ApiError } from '@trigger.dev/sdk'
import {
  planConceptEdit,
  refreshConcepts,
  requestApartmentConcepts,
  requestConcepts,
  requestDuoConcepts,
  reviseConcept,
} from './concepts'

describe('защита платной генерации от двойного запуска', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRoom.mockResolvedValue({
      id: 'room-1',
      projectId: 'project-1',
      role: 'owner',
      condition: 'bare',
      notes: null,
    })
    mocks.claim.mockResolvedValue(true)
    mocks.limit.mockResolvedValue({ success: true })
    mocks.trigger.mockResolvedValue({ id: 'run-1', publicAccessToken: 'token-1' })
    mocks.attach.mockResolvedValue(undefined)
    mocks.audit.mockResolvedValue(undefined)
    mocks.clear.mockResolvedValue(undefined)
    mocks.getProject.mockResolvedValue({ role: 'owner', rooms: [] })
    mocks.apartmentPlan.mockReturnValue({ ready: [{ id: 'room-1' }] })
    mocks.duoOffer.mockResolvedValue({
      proposal: { bridges: [{ title: 'Общий вариант' }] },
      hash: 'hash',
    })
    mocks.pending.mockResolvedValue(0)
    mocks.running.mockResolvedValue(false)
    mocks.editConcept.mockResolvedValue({ id: 'concept-1', roomId: 'room-1' })
    mocks.buildPlan.mockResolvedValue({
      steps: [{ titleRu: 'Синее покрывало', prompt: 'Blue bedspread', needsObject: false }],
      warningRu: '',
    })
  })

  it('показывает и запускает одни шаги с одним вызовом планировщика', async () => {
    const preview = await planConceptEdit('concept-1', { request: 'Синее покрывало' })
    expect(preview.ok).toBe(true)
    if (!preview.ok) throw new Error('preview failed')
    const result = await reviseConcept('concept-1', {
      request: 'Синее покрывало',
      planToken: preview.data.planToken,
    })
    expect(result.ok).toBe(true)
    expect(mocks.buildPlan).toHaveBeenCalledTimes(1)
    expect(mocks.trigger.mock.calls[0]?.[1].editSteps).toEqual(preview.data.steps)
  })

  it.each(['changed-request', 'changed-concept', 'tampered', 'expired'])(
    'не оплачивает повторный разбор при недействительном подтверждении: %s',
    async (change) => {
      const preview = await planConceptEdit('concept-1', { request: 'Синее покрывало' })
      if (!preview.ok) throw new Error('preview failed')
      if (change === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000)
      try {
        const result = await reviseConcept(
          change === 'changed-concept' ? 'concept-2' : 'concept-1',
          {
            request: change === 'changed-request' ? 'Красное покрывало' : 'Синее покрывало',
            planToken: preview.data.planToken + (change === 'tampered' ? '.changed' : ''),
          },
        )
        expect(result.ok).toBe(false)
        expect(mocks.buildPlan).toHaveBeenCalledTimes(1)
        expect(mocks.trigger).not.toHaveBeenCalled()
      } finally {
        vi.restoreAllMocks()
      }
    },
  )

  it('не отправляет вторую задачу, если комнату уже занял другой запрос', async () => {
    mocks.claim.mockResolvedValue(false)

    const result = await requestConcepts('room-1')

    expect(result).toEqual({
      ok: false,
      error: 'Эта комната уже считается. Дождитесь готовых вариантов.',
      checkStatus: true,
    })
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('освобождает только свою бронь после однозначного HTTP-отказа API', async () => {
    mocks.trigger.mockRejectedValue(new ApiError(422, {}, 'invalid task', {}))

    await expect(requestConcepts('room-1')).resolves.toMatchObject({ ok: false })

    expect(mocks.clear).toHaveBeenCalledWith('room-1', expect.stringMatching(/^pending:/))
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it.each([new Error('queue timeout'), new ApiError(503, {}, 'unavailable', {})])(
    'не освобождает комнату при неопределённом ответе очереди: %s',
    async (error) => {
      mocks.trigger.mockRejectedValue(error)
      await expect(requestConcepts('room-1')).resolves.toMatchObject({
        ok: false,
        checkStatus: true,
      })
      expect(mocks.clear).not.toHaveBeenCalled()
      expect(mocks.attach).not.toHaveBeenCalled()
    },
  )

  it('записывает ровно один принятый запуск', async () => {
    const result = await requestConcepts('room-1')

    expect(result).toMatchObject({ ok: true, data: { runId: 'run-1', accessToken: 'token-1' } })
    expect(mocks.claim).toHaveBeenCalledTimes(1)
    expect(mocks.trigger).toHaveBeenCalledTimes(1)
    expect(mocks.attach).toHaveBeenCalledTimes(1)
    expect(mocks.clear).not.toHaveBeenCalled()
    const batchId = mocks.claim.mock.calls[0]?.[1]
    expect(mocks.trigger).toHaveBeenCalledWith(
      'generate-concept',
      expect.objectContaining({ batchId }),
      {
        idempotencyKey: batchId,
        tags: [`concept-batch:${batchId}`],
      },
      { retry: { maxAttempts: 1 } },
    )
  })

  it('не предлагает новый запуск, если принятая задача не записалась локально', async () => {
    mocks.attach.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(requestConcepts('room-1')).resolves.toMatchObject({ ok: false, checkStatus: true })
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('не теряет принятый запуск при сбое аудита', async () => {
    mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(requestConcepts('room-1')).resolves.toMatchObject({ ok: true })
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('освобождает свою бронь при отказе лимитера до отправки задачи', async () => {
    mocks.limit.mockRejectedValueOnce(new Error('redis unavailable'))
    await expect(requestConcepts('room-1')).resolves.toMatchObject({ ok: false })
    expect(mocks.trigger).not.toHaveBeenCalled()
    expect(mocks.clear).toHaveBeenCalledWith('room-1', expect.stringMatching(/^pending:/))
  })

  it('не освобождает комнату, когда первая картинка ещё не создана', async () => {
    mocks.running.mockResolvedValueOnce(true)
    await expect(refreshConcepts('room-1')).resolves.toEqual({ ok: true, data: { pending: 1 } })
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('генерация на двоих не обходит занятую комнату', async () => {
    mocks.claim.mockResolvedValueOnce(false)
    await expect(requestDuoConcepts('room-1')).resolves.toMatchObject({
      ok: false,
      checkStatus: true,
    })
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('генерация на двоих записывает запуск для возвращения в комнату', async () => {
    await expect(requestDuoConcepts('room-1')).resolves.toMatchObject({ ok: true })
    expect(mocks.attach).toHaveBeenCalledWith('room-1', 'run-1', expect.any(String))
  })

  it('запуск квартиры сохраняет бронь при потерянном ответе', async () => {
    mocks.trigger.mockRejectedValueOnce(new Error('queue timeout'))
    await expect(requestApartmentConcepts('project-1')).resolves.toMatchObject({
      ok: false,
      checkStatus: true,
    })
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('частичный запуск квартиры не выдаёт сбой очереди за исчерпанный лимит', async () => {
    mocks.apartmentPlan.mockReturnValue({ ready: [{ id: 'room-1' }, { id: 'room-2' }] })
    mocks.trigger.mockRejectedValueOnce(new Error('queue timeout'))
    await expect(requestApartmentConcepts('project-1')).resolves.toMatchObject({
      ok: true,
      data: {
        started: 1,
        asked: 2,
        notice: expect.stringContaining('ответ очереди не подтверждён'),
      },
    })
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('не тратит лимит на занятую комнату при запуске квартиры', async () => {
    mocks.claim.mockResolvedValueOnce(false)
    await requestApartmentConcepts('project-1')
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })
})
