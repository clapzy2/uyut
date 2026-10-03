import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  attach: vi.fn(),
  fail: vi.fn(),
  trigger: vi.fn(),
  token: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: mocks.trigger },
  auth: { createPublicToken: mocks.token },
}))
vi.mock('@/lib/exports/repository', () => ({
  createExport: mocks.create,
  attachRun: mocks.attach,
  markExportFailed: mocks.fail,
}))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))

import { startExport } from './start'

describe('запуск PDF и граница внешней очереди', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.create.mockResolvedValue({ id: 'export', kind: 'free' })
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
    expect(mocks.trigger).toHaveBeenCalledExactlyOnceWith('export-pdf', { exportId: 'export' })
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
    const unavailable = new Error('Queue unavailable')
    mocks.trigger.mockRejectedValue(unavailable)
    await expect(startExport('owner', 'project', {})).rejects.toBe(unavailable)
    expect(mocks.fail).toHaveBeenCalledWith(
      'export',
      'очередь не приняла задачу: Error: Queue unavailable',
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
    mocks.create.mockResolvedValue({ id: 'export', kind: 'paid' })
    mocks.trigger.mockResolvedValue({ id: 'run' })
    mocks.token.mockRejectedValue(new Error('Token unavailable'))
    await expect(startExport('owner', 'project', {})).rejects.toThrow('Token unavailable')
    expect(mocks.attach).toHaveBeenCalledWith('export', 'run')
    expect(mocks.trigger).toHaveBeenCalledOnce()
    // Задача уже принята: нельзя объявлять её сборку упавшей только из-за подписки UI.
    expect(mocks.fail).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: 'paid' }) }),
    )
  })
})
