import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  attach: vi.fn(),
  fail: vi.fn(),
  trigger: vi.fn(),
  token: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trigger.dev/sdk')>()),
  tasks: { trigger: mocks.trigger },
  auth: { createPublicToken: mocks.token },
}))
vi.mock('@/lib/exports/repository', () => ({
  claimExport: mocks.create,
  getExport: mocks.get,
  attachRun: mocks.attach,
  markExportFailed: mocks.fail,
}))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))

import { ApiError } from '@trigger.dev/sdk'
import { startExport } from './start'

describe('запуск PDF и граница внешней очереди', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.create.mockResolvedValue({ id: 'export', kind: 'free', existing: false })
    mocks.trigger.mockResolvedValue({ id: 'run', publicAccessToken: 'read-run-token' })
    mocks.attach.mockResolvedValue(undefined)
    mocks.fail.mockResolvedValue(undefined)
    mocks.audit.mockResolvedValue(undefined)
    mocks.token.mockResolvedValue('scoped-token')
  })

  it('не отправляет задачу без разрешённой записи экспорта', async () => {
    const denied = new Error('Экспорт не найден')
    mocks.create.mockRejectedValue(denied)
    await expect(startExport('stranger', 'project', {})).rejects.toBe(denied)
    expect(mocks.trigger).not.toHaveBeenCalled()
    expect(mocks.attach).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('отправляет только ID экспорта и возвращает токен ровно принятого запуска', async () => {
    const options = { includeClientName: true }
    expect(await startExport('owner', 'project', options)).toEqual({
      exportId: 'export',
      runId: 'run',
      accessToken: 'read-run-token',
      kind: 'free',
    })
    expect(mocks.create).toHaveBeenCalledWith('owner', 'project', options)
    expect(mocks.trigger).toHaveBeenCalledExactlyOnceWith(
      'export-pdf',
      { exportId: 'export' },
      { idempotencyKey: 'export', tags: ['project-export:export'] },
      { retry: { maxAttempts: 1 } },
    )
    expect(mocks.attach).toHaveBeenCalledWith('export', 'run')
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith({
      action: 'export.requested',
      actorId: 'owner',
      targetType: 'project_export',
      targetId: 'export',
      metadata: { projectId: 'project', kind: 'free', runId: 'run', options },
    })
  })

  it('при отказе очереди помечает запись ошибкой, не выдаёт токен и не повторяет запуск', async () => {
    const unavailable = new ApiError(400, {}, 'Queue unavailable', {})
    mocks.trigger.mockRejectedValue(unavailable)
    await expect(startExport('owner', 'project', {})).rejects.toBe(unavailable)
    expect(mocks.fail).toHaveBeenCalledWith(
      'export',
      expect.stringContaining('очередь отклонила задачу:'),
    )
    expect(mocks.trigger).toHaveBeenCalledOnce()
    expect(mocks.attach).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('резервный публичный токен разрешает чтение только одного запуска', async () => {
    mocks.trigger.mockResolvedValue({ id: 'run' })
    const result = await startExport('owner', 'project', {})
    expect(result.accessToken).toBe('scoped-token')
    expect(mocks.token).toHaveBeenCalledExactlyOnceWith({ scopes: { read: { runs: ['run'] } } })
  })

  it('не заменяет оплаченный вид документа и не перезапускает уже принятую задачу при сбое токена', async () => {
    mocks.create.mockResolvedValue({ id: 'export', kind: 'paid', existing: false })
    mocks.trigger.mockResolvedValue({ id: 'run' })
    mocks.token.mockRejectedValue(new Error('Token unavailable'))
    await expect(startExport('owner', 'project', {})).rejects.toThrow(
      'Статус сборки пока не подтверждён',
    )
    expect(mocks.attach).toHaveBeenCalledWith('export', 'run')
    expect(mocks.trigger).toHaveBeenCalledOnce()
    // Задача уже принята: нельзя объявлять её сборку упавшей только из-за подписки UI.
    expect(mocks.fail).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: 'paid' }) }),
    )
  })
  it('keeps an uncertain request reserved instead of marking it failed', async () => {
    mocks.trigger.mockRejectedValue(new Error('Connection lost'))
    await expect(startExport('owner', 'project', {})).rejects.toThrow('Статус сборки')
    expect(mocks.fail).not.toHaveBeenCalled()
  })

  it('does not trigger an already active export', async () => {
    mocks.create.mockResolvedValue({ id: 'export', kind: 'free', existing: true })
    mocks.get.mockResolvedValue({ status: 'running' })
    await expect(startExport('owner', 'project', {})).rejects.toThrow('Статус сборки')
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('returns the accepted run when audit logging fails', async () => {
    mocks.audit.mockRejectedValue(new Error('Audit unavailable'))
    expect((await startExport('owner', 'project', {})).runId).toBe('run')
    expect(mocks.fail).not.toHaveBeenCalled()
  })

  it('keeps the accepted task reserved when saving its run ID fails', async () => {
    mocks.attach.mockRejectedValue(new Error('Database unavailable'))
    await expect(startExport('owner', 'project', {})).rejects.toThrow('Статус сборки')
    expect(mocks.trigger).toHaveBeenCalledOnce()
    expect(mocks.fail).not.toHaveBeenCalled()
  })

  it.each([408, 409, 503])('does not release an uncertain HTTP %s response', async (status) => {
    mocks.trigger.mockRejectedValue(new ApiError(status, {}, 'Unknown response', {}))
    await expect(startExport('owner', 'project', {})).rejects.toThrow('Статус сборки')
    expect(mocks.fail).not.toHaveBeenCalled()
  })

  it('allows a new attempt only after a terminal record and a fresh claim', async () => {
    mocks.create
      .mockResolvedValueOnce({ id: 'old', kind: 'free', existing: true })
      .mockResolvedValueOnce({ id: 'new', kind: 'free', existing: false })
    mocks.get.mockResolvedValue({ status: 'failed' })
    expect((await startExport('owner', 'project', {})).exportId).toBe('new')
    expect(mocks.trigger).toHaveBeenCalledOnce()
    expect(mocks.trigger.mock.calls[0]?.[1]).toEqual({ exportId: 'new' })
  })

  it('does not dispatch when another tab claims the retry first', async () => {
    mocks.create
      .mockResolvedValueOnce({ id: 'old', kind: 'free', existing: true })
      .mockResolvedValueOnce({ id: 'another', kind: 'free', existing: true })
    mocks.get.mockResolvedValue({ status: 'failed' })
    await expect(startExport('owner', 'project', {})).rejects.toThrow('Статус сборки')
    expect(mocks.trigger).not.toHaveBeenCalled()
  })
})
