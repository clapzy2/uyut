import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({ runs: queue }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ TRIGGER_SECRET_KEY: 'test' }) }))

import { exportQueueStatus } from './run-status'

describe('PDF queue reconciliation', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each(['EXECUTING', 'QUEUED', 'WAITING_FOR_DEPLOY'])('preserves %s', async (status) => {
    queue.retrieve.mockResolvedValue({ status })
    expect(await exportQueueStatus('export', 'run')).toEqual({ runId: 'run', terminal: false })
  })
  it.each(['FAILED', 'COMPLETED', 'CANCELED', 'CRASHED', 'TIMED_OUT'])(
    'reconciles terminal %s',
    async (status) => {
      queue.retrieve.mockResolvedValue({ status })
      expect((await exportQueueStatus('export', 'run')).terminal).toBe(true)
    },
  )
  it('finds an accepted request by exact export tag', async () => {
    queue.list.mockResolvedValue({ data: [{ id: 'found' }] })
    queue.retrieve.mockResolvedValue({ status: 'EXECUTING' })
    expect(await exportQueueStatus('export', null)).toEqual({ runId: 'found', terminal: false })
    expect(queue.list).toHaveBeenCalledWith(
      { taskIdentifier: 'export-pdf', tag: 'project-export:export', limit: 2 },
      { retry: { maxAttempts: 1 } },
    )
  })
  it.each([{ data: [] }, { data: [{ id: 'a' }, { id: 'b' }] }])(
    'keeps ambiguous tag lookup unknown',
    async ({ data }) => {
      queue.list.mockResolvedValue({ data })
      await expect(exportQueueStatus('export', null)).rejects.toThrow('Статус сборки')
      expect(queue.retrieve).not.toHaveBeenCalled()
    },
  )
  it('keeps unavailable queue unknown', async () => {
    queue.retrieve.mockRejectedValue(new Error('Network'))
    await expect(exportQueueStatus('export', 'run')).rejects.toThrow('Статус сборки')
  })
})
