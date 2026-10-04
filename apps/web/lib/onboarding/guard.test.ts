import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  state: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('not-found')
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('./repository', () => ({ getOnboardingState: mocks.state }))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
}))

import { AccessError } from '@/lib/projects/access'
import { requireStepProject } from './guard'

beforeEach(() => vi.resetAllMocks())

describe('возврат к шагу и квартире после входа', () => {
  it.each([2, 3, 4, 5])('сохраняет проект при входе на шаг %s', async (step) => {
    mocks.session.mockResolvedValue(null)
    const project = 'fee43460-a617-42b0-ae13-fefaf41359e8'
    await expect(requireStepProject(Promise.resolve({ project }), step)).rejects.toThrow(
      'redirect:',
    )
    const destination = mocks.redirect.mock.calls[0]?.[0]
    const login = new URL(destination ?? '', 'https://example.test')
    expect(login.pathname).toBe('/login')
    expect(login.searchParams.get('next')).toBe(`/onboarding/step-${step}?project=${project}`)
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('кодирует значение project отдельно от адреса возврата', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(
      requireStepProject(Promise.resolve({ project: 'project&next=/other' }), 2),
    ).rejects.toThrow('redirect:')
    const login = new URL(mocks.redirect.mock.calls[0]?.[0] ?? '', 'https://example.test')
    const returned = new URL(login.searchParams.get('next') ?? '', login.origin)
    expect(returned.pathname).toBe('/onboarding/step-2')
    expect(returned.searchParams.get('project')).toBe('project&next=/other')
    expect(returned.searchParams.has('next')).toBe(false)
  })

  it('сохраняет прежний маршрут входа, если проект не указан', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(requireStepProject(Promise.resolve({}), 2)).rejects.toThrow('redirect:')
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=/onboarding/step-2')
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('после входа без проекта отправляет на первый шаг', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user' } })
    await expect(requireStepProject(Promise.resolve({}), 2)).rejects.toThrow('redirect:')
    expect(mocks.redirect).toHaveBeenCalledWith('/onboarding/step-1')
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('сохраняет проверку доступа к указанной квартире', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user' } })
    const state = { id: 'project', rooms: [] }
    mocks.state.mockResolvedValue(state)
    expect(await requireStepProject(Promise.resolve({ project: 'project' }), 3)).toBe(state)
    expect(mocks.state).toHaveBeenCalledWith('user', 'project')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('чужой проект по-прежнему отдаёт 404', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user' } })
    mocks.state.mockRejectedValue(new AccessError('owner-only'))
    await expect(requireStepProject(Promise.resolve({ project: 'project' }), 3)).rejects.toThrow(
      'not-found',
    )
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })

  it('не скрывает неожиданный отказ чтения проекта', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user' } })
    const error = new Error('database-unavailable')
    mocks.state.mockRejectedValue(error)
    await expect(requireStepProject(Promise.resolve({ project: 'project' }), 3)).rejects.toBe(error)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
