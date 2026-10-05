import type { EffectCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ pathname: '/', effects: [] as EffectCallback[] }))
vi.mock('react', () => ({
  useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
}))
vi.mock('next/navigation', () => ({ usePathname: () => hooks.pathname }))

const init = vi.fn()
const capture = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_public_test_key')
  vi.stubGlobal('navigator', { doNotTrack: '0', globalPrivacyControl: false })
  vi.stubGlobal('window', {
    location: { pathname: '/', href: 'https://domitsa.ru/?private-token=secret' },
  })
  hooks.pathname = '/'
  hooks.effects = []
  init.mockReset()
  capture.mockReset()
  vi.doMock('posthog-js', () => ({ default: { init, capture } }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function mount() {
  const { Analytics } = await import('@/components/analytics')
  Analytics()
  const cleanup = hooks.effects.pop()?.()
  return { Analytics, cleanup }
}

describe('жизненный цикл счётчика', () => {
  it('отправляет один фиксированный этап без адреса и параметров ссылки', async () => {
    await mount()
    await vi.dynamicImportSettled()
    expect(init).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledExactlyOnceWith('pilot_stage_viewed', {
      stage: 'landing',
      funnel_version: 1,
    })
    expect(init.mock.calls[0]?.[1]).toMatchObject({
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      disable_session_recording: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      respect_dnt: true,
      ip: false,
      person_profiles: 'never',
      save_referrer: false,
      save_campaign_params: false,
    })
    expect(init.mock.calls[0]?.[1].get_current_url()).toBe('https://domitsa.ru/analytics/landing')
  })

  it.each([{ doNotTrack: '1' }, { globalPrivacyControl: true }])(
    'не инициализирует SDK при запрете %j',
    async (privacy) => {
      vi.stubGlobal('navigator', privacy)
      await mount()
      await vi.dynamicImportSettled()
      expect(init).not.toHaveBeenCalled()
      expect(capture).not.toHaveBeenCalled()
    },
  )

  it('не инициализирует SDK без ключа', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    await mount()
    await vi.dynamicImportSettled()
    expect(init).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('не отслеживает ссылку восстановления пароля', async () => {
    hooks.pathname = '/reset-password'
    await mount()
    await vi.dynamicImportSettled()
    expect(init).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('не отправляет экран после размонтирования во время загрузки', async () => {
    const { cleanup } = await mount()
    if (typeof cleanup === 'function') {
      cleanup()
    }
    await vi.dynamicImportSettled()
    expect(init).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('при быстром переходе во время загрузки считает только актуальный экран', async () => {
    const { Analytics, cleanup } = await mount()
    if (typeof cleanup === 'function') {
      cleanup()
    }
    hooks.pathname = '/projects'
    Analytics()
    hooks.effects.pop()?.()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    expect(capture).toHaveBeenCalledExactlyOnceWith('pilot_stage_viewed', {
      stage: 'projects',
      funnel_version: 1,
    })
  })

  it('не повторяет инициализацию при следующем переходе', async () => {
    const { Analytics, cleanup } = await mount()
    await vi.dynamicImportSettled()
    if (typeof cleanup === 'function') {
      cleanup()
    }
    hooks.pathname = '/onboarding/step-1'
    Analytics()
    hooks.effects.pop()?.()
    await vi.dynamicImportSettled()
    expect(init).toHaveBeenCalledOnce()
    expect(capture.mock.calls.map((call) => call[1].stage)).toEqual(['landing', 'onboarding_1'])
  })

  it('блокирует уже подготовленное событие после включения приватного режима', async () => {
    await mount()
    await vi.dynamicImportSettled()
    vi.stubGlobal('navigator', { globalPrivacyControl: true })
    const beforeSend = init.mock.calls[0]?.[1].before_send
    expect(
      beforeSend({
        event: 'pilot_stage_viewed',
        properties: {
          stage: 'landing',
          funnel_version: 1,
          token: 'phc_public_test_key',
          distinct_id: 'f9a9e590-1163-4e5a-ab59-81bbe6da23b7',
        },
      }),
    ).toBeNull()
  })

  it('не пробрасывает отказ инициализации счётчика в приложение', async () => {
    init.mockImplementationOnce(() => {
      throw new Error('analytics blocked')
    })
    await mount()
    await vi.dynamicImportSettled()
    expect(capture).not.toHaveBeenCalled()
  })
})
