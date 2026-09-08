import { describe, expect, it } from 'vitest'
import { isAuthCookieName, isStaleSessionBounce } from './stale-session'

describe('isStaleSessionBounce', () => {
  it('узнаёт разворот с защищённой страницы при живом печенье', () => {
    expect(
      isStaleSessionBounce({ hasSessionCookie: true, isGuestOnlyPath: true, hasNextParam: true }),
    ).toBe(true)
  })

  it('не трогает обычный заход на страницу входа', () => {
    // Человек сам нажал «Войти»: печенья нет, разворачивать нечего
    expect(
      isStaleSessionBounce({ hasSessionCookie: false, isGuestOnlyPath: true, hasNextParam: true }),
    ).toBe(false)
    // Вошедший открыл /login руками — его штатно уводит в проекты
    expect(
      isStaleSessionBounce({ hasSessionCookie: true, isGuestOnlyPath: true, hasNextParam: false }),
    ).toBe(false)
  })

  it('не срабатывает вне страниц для гостей', () => {
    expect(
      isStaleSessionBounce({ hasSessionCookie: true, isGuestOnlyPath: false, hasNextParam: true }),
    ).toBe(false)
  })
})

describe('isAuthCookieName', () => {
  it('ловит печенье во всех написаниях', () => {
    expect(isAuthCookieName('better-auth.session_token')).toBe(true)
    expect(isAuthCookieName('__Secure-better-auth.session_token')).toBe(true)
    expect(isAuthCookieName('__Host-better-auth.session_data')).toBe(true)
  })

  it('не трогает чужое печенье', () => {
    expect(isAuthCookieName('theme')).toBe(false)
    expect(isAuthCookieName('ph_phc_abc_posthog')).toBe(false)
    // Похожее имя, но не наше: гасить чужое нельзя
    expect(isAuthCookieName('better-auth.session_token.backup')).toBe(false)
  })
})
