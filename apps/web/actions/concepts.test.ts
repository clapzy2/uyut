import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  audit: vi.fn(),
  claim: vi.fn(),
  clear: vi.fn(),
  getRoom: vi.fn(),
  limit: vi.fn(),
  token: vi.fn(),
  trigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  auth: { createPublicToken: mocks.token },
  tasks: { trigger: mocks.trigger },
}))
vi.mock('@uyut/ai', () => ({ buildEditPlan: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/collaboration/live', () => ({ bumpProjectVersion: vi.fn() }))
vi.mock('@/lib/concepts/apartment', () => ({ APARTMENT_COUNT: 3, apartmentPlan: vi.fn() }))
vi.mock('@/lib/concepts/duo', () => ({ getDuoOffer: vi.fn() }))
vi.mock('@/lib/concepts/repository', () => ({}))
vi.mock('@/lib/concepts/resume-run', () => ({ generationStillRunning: vi.fn() }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ FAL_KEY: 'test', TRIGGER_SECRET_KEY: 'test' }),
}))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  requireOwner: vi.fn(),
}))
vi.mock('@/lib/projects/repository', () => ({
  attachGenerationRun: mocks.attach,
  claimRoomForGeneration: mocks.claim,
  clearGenerationRun: mocks.clear,
  getProject: vi.fn(),
  getRoom: mocks.getRoom,
}))
vi.mock('@/lib/redis', () => ({
  getConceptsByUserLimiter: () => ({ limit: mocks.limit }),
}))
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ user: { id: 'user-1' } }),
}))
vi.mock('@/lib/validation/projects', () => ({ conceptEditSchema: { safeParse: vi.fn() } }))

import { requestConcepts } from './concepts'

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
  })

  it('не отправляет вторую задачу, если комнату уже занял другой запрос', async () => {
    mocks.claim.mockResolvedValue(false)

    const result = await requestConcepts('room-1')

    expect(result).toEqual({
      ok: false,
      error: 'Эта комната уже считается. Дождитесь готовых вариантов.',
    })
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('освобождает комнату, если очередь не приняла задачу', async () => {
    mocks.trigger.mockRejectedValue(new Error('queue unavailable'))

    await expect(requestConcepts('room-1')).resolves.toMatchObject({ ok: false })

    expect(mocks.clear).toHaveBeenCalledWith('room-1')
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('записывает ровно один принятый запуск', async () => {
    const result = await requestConcepts('room-1')

    expect(result).toMatchObject({ ok: true, data: { runId: 'run-1', accessToken: 'token-1' } })
    expect(mocks.claim).toHaveBeenCalledTimes(1)
    expect(mocks.trigger).toHaveBeenCalledTimes(1)
    expect(mocks.attach).toHaveBeenCalledTimes(1)
    expect(mocks.clear).not.toHaveBeenCalled()
  })
})
