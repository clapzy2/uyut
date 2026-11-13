import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  saveContact: vi.fn(),
  limit: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/session', () => ({ getSession: async () => ({ user: { id: 'owner' } }) }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ TRIGGER_SECRET_KEY: 'test-only' }) }))
vi.mock('@/lib/redis', () => ({ getExportsByUserLimiter: () => ({ limit: mocks.limit }) }))
vi.mock('@/lib/exports/start', () => ({ startExport: mocks.start }))
vi.mock('@/lib/exports/repository', () => ({
  listExports: mocks.list,
  getExport: mocks.get,
  saveContact: mocks.saveContact,
}))

import { ExportStatusUnknownError } from '@/lib/exports/run-status'
import { exportProjectPdf, loadExport, loadExports } from './exports'

const projectId = '00000000-0000-4000-8000-000000000001'

describe('PDF action recovery without starting another task', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.limit.mockResolvedValue({ success: true })
  })

  it('requires status verification after an uncertain or already active launch', async () => {
    mocks.start.mockRejectedValue(new ExportStatusUnknownError())
    const result = await exportProjectPdf({ projectId })
    expect(result).toMatchObject({ ok: false, checkStatus: true })
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })

  it('allows correction after validation rejection without calling the queue', async () => {
    const result = await exportProjectPdf({ projectId: 'bad-id' })
    expect(result).toMatchObject({ ok: false })
    expect(result).not.toHaveProperty('checkStatus')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('checks the existing export or list without invoking start or the rate limiter', async () => {
    mocks.get.mockResolvedValue({ id: 'export', status: 'running' })
    mocks.list.mockResolvedValue([{ id: 'export', status: 'ready' }])
    expect(await loadExport('export')).toMatchObject({ ok: true, data: { status: 'running' } })
    expect(await loadExports(projectId)).toMatchObject({ ok: true, data: [{ status: 'ready' }] })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.limit).not.toHaveBeenCalled()
  })

  it('does not report a successful start when status verification is unavailable', async () => {
    mocks.get.mockRejectedValue(new ExportStatusUnknownError())
    expect(await loadExport('export')).toMatchObject({ ok: false, checkStatus: true })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
