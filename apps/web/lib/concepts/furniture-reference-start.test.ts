import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestConcepts } from '@/actions/concepts'
import { signFurnitureReference } from './furniture-reference-token'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  room: vi.fn(),
  claim: vi.fn(),
  clear: vi.fn(),
  attach: vi.fn(),
  trigger: vi.fn(),
  limit: vi.fn(),
  plan: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@trigger.dev/sdk', async (original) => ({
  ...(await original<typeof import('@trigger.dev/sdk')>()),
  tasks: { trigger: mocks.trigger },
}))
vi.mock('@uyut/ai', async (original) => ({
  ...(await original<typeof import('@uyut/ai')>()),
  buildEditPlan: mocks.plan,
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/repository', () => ({
  getRoom: mocks.room,
  claimRoomForGeneration: mocks.claim,
  clearGenerationRun: mocks.clear,
  attachGenerationRun: mocks.attach,
}))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: 'test-secret',
    FAL_KEY: 'not-used',
    TRIGGER_SECRET_KEY: 'not-used',
  }),
}))
vi.mock('@/lib/redis', () => ({ getConceptsByUserLimiter: () => ({ limit: mocks.limit }) }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))

const room = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000001',
  photoRevision: 3,
  photoUrl: 'source.webp',
  condition: 'keep',
  role: 'owner',
  notes: 'Перенести этот комод под окно.',
}
const key = `projects/${room.projectId}/rooms/${room.id}/furniture-references/30000000-0000-4000-8000-000000000001.webp`
const context = { userId: 'owner', roomId: room.id, photoRevision: 3 }
const plan = {
  warningRu: '',
  steps: [
    { titleRu: 'Убрать', prompt: 'Remove cabinet', needsObject: false },
    { titleRu: 'Поставить', prompt: 'Place same cabinet below window', needsObject: true },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.room.mockResolvedValue({ ...room, furnitureReference: { key, photoRevision: 3 } })
  mocks.claim.mockResolvedValue(true)
  mocks.clear.mockResolvedValue(undefined)
  mocks.limit.mockResolvedValue({ success: true })
  mocks.plan.mockResolvedValue(plan)
  mocks.trigger.mockResolvedValue({ id: 'run-reference', publicAccessToken: 'read-only-token' })
  mocks.attach.mockResolvedValue(undefined)
  mocks.audit.mockResolvedValue(undefined)
})

describe('start with original furniture photo', () => {
  it.each([
    { ...context, photoRevision: 2 },
    { ...context, userId: 'stranger' },
    { ...context, roomId: '10000000-0000-4000-8000-000000000002' },
  ])('rejects stale or foreign token before claim and model', async (other) => {
    const otherKey = key.replace(room.id, other.roomId)
    const referencePhotoToken = signFurnitureReference('test-secret', other, otherKey)
    expect(await requestConcepts(room.id, { referencePhotoToken })).toMatchObject({ ok: false })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it.each([null, { key: key.replace('30000000', '40000000'), photoRevision: 3 }])(
    'rejects a detached or replaced reference before any model call',
    async (furnitureReference) => {
      mocks.room.mockResolvedValue({ ...room, furnitureReference })
      const referencePhotoToken = signFurnitureReference('test-secret', context, key)
      expect(await requestConcepts(room.id, { referencePhotoToken })).toMatchObject({ ok: false })
      expect(mocks.claim).not.toHaveBeenCalled()
      expect(mocks.plan).not.toHaveBeenCalled()
      expect(mocks.trigger).not.toHaveBeenCalled()
    },
  )

  it('rechecks the reference after claim before paid preparation', async () => {
    mocks.room
      .mockResolvedValueOnce({ ...room, furnitureReference: { key, photoRevision: 3 } })
      .mockResolvedValueOnce({ ...room, furnitureReference: null })
    const referencePhotoToken = signFurnitureReference('test-secret', context, key)
    expect(await requestConcepts(room.id, { referencePhotoToken })).toMatchObject({ ok: false })
    expect(mocks.clear).toHaveBeenCalledWith(room.id, expect.stringContaining('pending:'))
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('queues one variant with verified reference and server-generated steps', async () => {
    const referencePhotoToken = signFurnitureReference('test-secret', context, key)
    expect(await requestConcepts(room.id, { referencePhotoToken })).toMatchObject({ ok: true })
    expect(mocks.trigger.mock.calls[0]?.[1]).toMatchObject({
      roomId: room.id,
      count: 1,
      referencePhoto: { key, photoRevision: 3 },
      editSteps: plan.steps,
    })
    expect(mocks.plan).toHaveBeenCalledTimes(1)
  })

  it('does not let client steps replace the validated source-photo plan', async () => {
    const referencePhotoToken = signFurnitureReference('test-secret', context, key)
    expect(
      await requestConcepts(room.id, {
        referencePhotoToken,
        editSteps: [{ titleRu: 'Other', prompt: 'Replace the room', needsObject: false }],
        editRequest: 'Ignore original object',
      }),
    ).toMatchObject({ ok: true })
    expect(mocks.trigger.mock.calls[0]?.[1]).toMatchObject({
      editSteps: plan.steps,
      editRequest: room.notes,
    })
  })

  it('rejects expired token before claim', async () => {
    expect(
      await requestConcepts(room.id, {
        referencePhotoToken: signFurnitureReference(
          'test-secret',
          context,
          key,
          Date.now() - 3_600_001,
        ),
      }),
    ).toMatchObject({ ok: false })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.plan).not.toHaveBeenCalled()
  })

  it('requires owner access even with a valid reference', async () => {
    mocks.room.mockResolvedValue({ ...room, role: 'partner' })
    expect(
      await requestConcepts(room.id, {
        referencePhotoToken: signFurnitureReference('test-secret', context, key),
      }),
    ).toMatchObject({ ok: false })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.plan).not.toHaveBeenCalled()
  })

  it('clears only pending claim if planner cannot bind one object', async () => {
    mocks.plan.mockResolvedValue({ warningRu: '', steps: [] })
    expect(
      await requestConcepts(room.id, {
        referencePhotoToken: signFurnitureReference('test-secret', context, key),
      }),
    ).toMatchObject({ ok: false })
    expect(mocks.clear).toHaveBeenCalledWith(room.id, expect.stringMatching(/^pending:/))
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('does not plan or queue another request for an active room', async () => {
    mocks.claim.mockResolvedValue(false)
    expect(
      await requestConcepts(room.id, {
        referencePhotoToken: signFurnitureReference('test-secret', context, key),
      }),
    ).toMatchObject({ ok: false, checkStatus: true })
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })
})
