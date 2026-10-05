import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  state: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/onboarding/repository', () => ({ getOnboardingState: mocks.state }))
vi.mock('@/lib/storage', () => ({ presignedObjectUrl: vi.fn() }))
vi.mock('@/actions/projects', () => ({ uploadPlan: vi.fn() }))
vi.mock('@/components/file-uploader', () => ({ FileUploader: () => null }))
vi.mock('@/components/plan-reading-card', () => ({ PlanReadingCard: () => null }))
vi.mock('@/components/onboarding/apartment-form', () => ({ ApartmentForm: () => null }))
vi.mock('@/components/onboarding/onboarding-shell', () => ({ OnboardingShell: () => null }))

import Step1 from './page'

beforeEach(() => vi.clearAllMocks())

describe('возврат к существующей квартире на первом шаге после входа', () => {
  it('сохраняет проект в адресе возврата при истёкшей сессии', async () => {
    mocks.session.mockResolvedValue(null)
    const project = 'fee43460-a617-42b0-ae13-fefaf41359e8'
    await expect(Step1({ searchParams: Promise.resolve({ project }) })).rejects.toThrow('redirect:')
    const login = new URL(mocks.redirect.mock.calls[0]?.[0] ?? '', 'https://example.test')
    expect(login.pathname).toBe('/login')
    expect(login.searchParams.get('next')).toBe(`/onboarding/step-1?project=${project}`)
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('кодирует project отдельно, не превращая его части в параметры возврата', async () => {
    mocks.session.mockResolvedValue(null)
    const project = 'project&next=/other'
    await expect(Step1({ searchParams: Promise.resolve({ project }) })).rejects.toThrow('redirect:')
    const login = new URL(mocks.redirect.mock.calls[0]?.[0] ?? '', 'https://example.test')
    const returned = new URL(login.searchParams.get('next') ?? '', login.origin)
    expect(returned.pathname).toBe('/onboarding/step-1')
    expect(returned.searchParams.get('project')).toBe(project)
    expect(returned.searchParams.has('next')).toBe(false)
  })

  it('оставляет прежний адрес входа для создания новой квартиры', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(Step1({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:')
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/login?next=/onboarding/step-1')
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('после входа продолжает читать тот же проект с прежней проверкой прав', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user' } })
    mocks.state.mockResolvedValue({ id: 'project', planUrl: null, planReading: null, rooms: [] })
    await Step1({ searchParams: Promise.resolve({ project: 'project' }) })
    expect(mocks.state).toHaveBeenCalledExactlyOnceWith('user', 'project')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
