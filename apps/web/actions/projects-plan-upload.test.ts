import type { PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  session: vi.fn(),
  prepare: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  setPlan: vi.fn(),
  setReading: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.owner,
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/plan-reading', () => ({
  PlanReadError: class PlanReadError extends Error {},
  readPlanFromStorage: vi.fn(),
}))
vi.mock('@/lib/files/uploads', () => ({
  UploadError: class UploadError extends Error {},
  preparePlan: mocks.prepare,
}))
vi.mock('@/lib/storage', () => ({
  putObject: mocks.put,
  deleteObject: mocks.remove,
}))
vi.mock('@/lib/projects/repository', () => ({
  setProjectPlan: mocks.setPlan,
  setPlanReading: mocks.setReading,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))

import { AccessError } from '@/lib/projects/access'
import { forgetPlanReading, uploadPlan } from './projects'

const projectId = 'f6fcb42e-2b4e-4b39-bb5c-31c9bfbe9f2f'
const reading: PlanReading = {
  readAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', widthCm: 400 }],
}
const source = { planUrl: 'old-plan.webp', planReading: reading }
const revision = planEditRevision(source.planUrl, source.planReading)

function upload() {
  const form = new FormData()
  form.set('plan', new File(['synthetic'], 'plan.webp', { type: 'image/webp' }))
  return form
}

describe('replacement and dismissal of a plan source', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(source)
    mocks.prepare.mockResolvedValue({
      body: Buffer.from('prepared'),
      extension: 'webp',
      contentType: 'image/webp',
    })
    mocks.put.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
    mocks.setPlan.mockResolvedValue({ previousKey: source.planUrl })
    mocks.setReading.mockResolvedValue(undefined)
  })

  it('rejects a stale upload before preparing or storing the file', async () => {
    expect(await uploadPlan(projectId, upload(), 'old-version')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(await uploadPlan(projectId, upload())).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.setPlan).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('passes the source to the atomic replacement and removes the old file only after success', async () => {
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(true)
    const key = mocks.put.mock.calls[0]?.[0]
    expect(mocks.setPlan).toHaveBeenCalledWith('owner', projectId, key, source)
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(source.planUrl)
    const savedAt = mocks.setPlan.mock.invocationCallOrder[0]
    const removedAt = mocks.remove.mock.invocationCallOrder[0]
    if (savedAt === undefined || removedAt === undefined) throw new Error('Missing write/delete')
    expect(savedAt).toBeLessThan(removedAt)
  })

  it('cleans up only its unused upload after a write conflict, never the active plan', async () => {
    mocks.setPlan.mockRejectedValueOnce(new PlanEditConflictError())
    expect(await uploadPlan(projectId, upload(), revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    const key = mocks.put.mock.calls[0]?.[0]
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(key)
    expect(mocks.remove).not.toHaveBeenCalledWith(source.planUrl)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('keeps the uploaded file if the write happened but its response was lost', async () => {
    mocks.setPlan.mockImplementationOnce(async (_owner, _id, key) => {
      mocks.owner.mockResolvedValue({ planUrl: key, planReading: null })
      throw new Error('lost database response')
    })
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(false)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('keeps the upload when its usage cannot be established safely', async () => {
    mocks.setPlan.mockImplementationOnce(async () => {
      mocks.owner.mockRejectedValue(new Error('database unavailable'))
      throw new Error('database unavailable')
    })
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(false)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('does not alter the plan when storage fails, and allows a new attempt', async () => {
    mocks.put.mockRejectedValueOnce(new Error('storage unavailable'))
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(false)
    expect(mocks.setPlan).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(true)
  })

  it('does not upload for an expired session or a non-owner', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(false)
    mocks.owner.mockRejectedValueOnce(new AccessError('Только владелец'))
    expect((await uploadPlan(projectId, upload(), revision)).ok).toBe(false)
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.setPlan).not.toHaveBeenCalled()
  })

  it('does not forget a newer reading from a stale form', async () => {
    expect(await forgetPlanReading(projectId, 'old-version')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.setReading).not.toHaveBeenCalled()
  })

  it('guards dismissal against an intervening edit and returns the empty source revision', async () => {
    mocks.setReading.mockRejectedValueOnce(new PlanEditConflictError())
    expect(await forgetPlanReading(projectId, revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.revalidate).not.toHaveBeenCalled()
    expect(await forgetPlanReading(projectId, revision)).toEqual({
      ok: true,
      data: { revision: planEditRevision(source.planUrl, null) },
    })
    expect(mocks.setReading).toHaveBeenLastCalledWith('owner', projectId, null, source)
  })
})
