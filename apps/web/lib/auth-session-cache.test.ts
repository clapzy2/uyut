import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('better-auth', () => ({ betterAuth: mocks.create }))
vi.mock('better-auth/api', () => ({
  APIError: class extends Error {},
  createAuthMiddleware: (value: unknown) => value,
}))
vi.mock('better-auth/plugins', () => ({ magicLink: (value: unknown) => value }))
vi.mock('better-auth/next-js', () => ({ nextCookies: () => ({ id: 'test' }) }))
vi.mock('@better-auth/drizzle-adapter', () => ({ drizzleAdapter: () => 'adapter' }))
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_URL: 'https://domitsa.test', BETTER_AUTH_SECRET: 'unchanged-test-secret' }),
}))
vi.mock('@/lib/redis', () => ({ createAuthStorage: () => ({}), getLoginByEmailLimiter: vi.fn() }))

import { getAuth, SESSION_COOKIE_CACHE_ENABLED, SESSION_COOKIE_CACHE_VERSION } from './auth'

beforeEach(() => mocks.create.mockReset())
describe('версия кэш-cookie после инцидента', () => {
  it('не принимает старую версию 1, сохраняя сроки и секрет авторизации', () => {
    getAuth()
    expect(SESSION_COOKIE_CACHE_VERSION).not.toBe('1')
    expect(SESSION_COOKIE_CACHE_ENABLED).toBe(false)
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      secret: 'unchanged-test-secret',
      session: {
        storeSessionInDatabase: true,
        expiresIn: 30 * 86400,
        cookieCache: { enabled: false, maxAge: 900, version: SESSION_COOKIE_CACHE_VERSION },
      },
    })
  })
})
