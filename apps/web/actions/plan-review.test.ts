import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  getRoom: vi.fn(),
  getSession: vi.fn(),
  limit: vi.fn(),
  revalidate: vi.fn(),
  source: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/concepts/plan-review', () => ({ planReviewSource: mocks.source }))
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: mocks.upsert }) }),
  }),
}))
vi.mock('@/lib/projects/repository', () => ({ getRoom: mocks.getRoom }))
vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))

import { savePlanReview } from './plan-review'

const conceptId = '0cf0d04a-59e5-40f7-8e15-04a0edeb5e02'
const sourceHash = 'a'.repeat(64)
const values = { shape: 'matches' as const, openings: ['not_visible' as const] }

describe('save manual comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.limit.mockResolvedValue([{ id: conceptId, roomId: 'room', renderUrl: 'render' }])
    mocks.getRoom.mockResolvedValue({
      id: 'room',
      projectId: 'project',
      role: 'owner',
      name: 'Гостиная',
      planUrl: null,
      project: { planUrl: 'plan', planReading: { geometry: {} } },
    })
    mocks.source.mockReturnValue({ hash: sourceHash, architecture: { openings: [{}] } })
    mocks.upsert.mockResolvedValue(undefined)
  })

  it('never writes without a session, owner role or matching source', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    expect((await savePlanReview(conceptId, sourceHash, values)).ok).toBe(false)

    mocks.getRoom.mockResolvedValueOnce({ ...(await mocks.getRoom()), role: 'partner' })
    expect((await savePlanReview(conceptId, sourceHash, values)).ok).toBe(false)

    mocks.source.mockReturnValueOnce({ hash: 'b'.repeat(64), architecture: { openings: [{}] } })
    expect((await savePlanReview(conceptId, sourceHash, values)).ok).toBe(false)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a missing or mismatched set of opening labels', async () => {
    expect(
      (await savePlanReview(conceptId, sourceHash, { shape: 'unrated', openings: ['unrated'] })).ok,
    ).toBe(false)
    expect(
      (await savePlanReview(conceptId, sourceHash, { shape: 'matches', openings: [] })).ok,
    ).toBe(false)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('saves one review and records a compact audit event', async () => {
    expect(await savePlanReview(conceptId, sourceHash, values)).toEqual({ ok: true })
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'concepts.plan_reviewed', actorId: 'owner' }),
    )
    expect(mocks.revalidate).toHaveBeenCalledTimes(1)
  })
})
