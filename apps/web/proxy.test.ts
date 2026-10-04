import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionCookie: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('better-auth/cookies', () => ({ getSessionCookie: mocks.sessionCookie }))
vi.mock('@/lib/redis', () => ({ getRequestsByIpLimiter: () => ({ limit: mocks.limit }) }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    APP_URL: 'https://domitsa.test',
    S3_ENDPOINT: 'https://storage.test',
    TRUSTED_PROXY_HOPS: 0,
  }),
}))

import { proxy } from './proxy'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessionCookie.mockReturnValue(null)
  mocks.limit.mockResolvedValue({ success: true })
})

describe('контекст входа на границе защищённых страниц', () => {
  it.each([
    '/onboarding/step-2?project=fee43460-a617-42b0-ae13-fefaf41359e8',
    '/profile?section=household',
    '/projects/project/rooms/room?view=plan&source=summary',
  ])('сохраняет путь и параметры %s', async (path) => {
    const response = await proxy(new NextRequest(`https://domitsa.test${path}`))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://domitsa.test')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe(path)
    expect(location.searchParams.has('project')).toBe(false)
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('не превращает вложенный next в внешний адрес возврата', async () => {
    const path = '/onboarding/step-2?project=project&next=https%3A%2F%2Fexternal.test'
    const response = await proxy(new NextRequest(`https://domitsa.test${path}`))
    const login = new URL(response.headers.get('location') ?? '')
    const next = new URL(login.searchParams.get('next') ?? '', login.origin)
    expect(next.origin).toBe('https://domitsa.test')
    expect(next.pathname).toBe('/onboarding/step-2')
    expect(next.searchParams.get('project')).toBe('project')
    expect(login.searchParams.get('next')).toBe(path)
  })

  it('сохраняет прежний вход без query-параметров', async () => {
    const response = await proxy(new NextRequest('https://domitsa.test/projects'))
    const login = new URL(response.headers.get('location') ?? '')
    expect(login.searchParams.get('next')).toBe('/projects')
  })

  it('пропускает защищённый маршрут с cookie для дальнейшей проверки сессии страницей', async () => {
    mocks.sessionCookie.mockReturnValue('session')
    const response = await proxy(
      new NextRequest('https://domitsa.test/onboarding/step-2?project=project'),
    )
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('сохраняет адрес возврата при очищении устаревших auth cookies, не удаляя тему', async () => {
    mocks.sessionCookie.mockReturnValue('stale')
    const next = '/onboarding/step-2?project=project'
    const request = new NextRequest(`https://domitsa.test/login?next=${encodeURIComponent(next)}`, {
      headers: {
        cookie: 'better-auth.session_token=old; __Secure-better-auth.session_data=old; theme=dark',
      },
    })
    const response = await proxy(request)
    expect(response.headers.get('location')).toBeNull()
    expect(request.nextUrl.searchParams.get('next')).toBe(next)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.cookies.get('better-auth.session_token')?.value).toBe('')
    expect(response.cookies.get('__Secure-better-auth.session_data')?.value).toBe('')
    expect(response.cookies.get('theme')).toBeUndefined()
    expect(request.cookies.get('theme')?.value).toBe('dark')
  })

  it('сохраняет переход вошедшего пользователя с обычного login на проекты', async () => {
    mocks.sessionCookie.mockReturnValue('session')
    const response = await proxy(new NextRequest('https://domitsa.test/login'))
    expect(response.headers.get('location')).toBe('https://domitsa.test/projects')
  })

  it('не обходит ограничение запросов ради редиректа', async () => {
    mocks.limit.mockResolvedValue({ success: false })
    const response = await proxy(
      new NextRequest('https://domitsa.test/onboarding/step-2?project=project'),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('location')).toBeNull()
    expect(mocks.sessionCookie).not.toHaveBeenCalled()
  })
})
