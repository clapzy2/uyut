'use client'

import { usePathname } from 'next/navigation'
import type { PostHog } from 'posthog-js'
import { useEffect } from 'react'
import {
  allowsPilotAnalytics,
  getPilotStage,
  PILOT_STAGE_EVENT,
  sanitizePilotEvent,
} from '@/lib/analytics'

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

let client: PostHog | null = null
let clientImport: Promise<PostHog> | null = null

function privacyAllowsTracking(): boolean {
  return allowsPilotAnalytics({
    doNotTrack: navigator.doNotTrack,
    windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack,
    globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl,
  })
}

/**
 * Минимальная воронка пилота: видим открытые этапы, но не считаем их успешными действиями.
 * Без ключа или при запрете отслеживания библиотека даже не загружается.
 */
export function Analytics() {
  const pathname = usePathname()

  useEffect(() => {
    const stage = getPilotStage(pathname)
    if (!key || !stage || !privacyAllowsTracking()) {
      return
    }
    let active = true
    clientImport ??= import('posthog-js').then((module) => module.default)
    void clientImport
      .then((posthog) => {
        // Переход или размонтирование во время загрузки не должны отправлять старый экран.
        if (!active || !privacyAllowsTracking()) {
          return
        }
        if (!client) {
          posthog.init(key, {
            api_host: host,
            capture_pageview: false,
            capture_pageleave: false,
            // Считаем только переходы по экранам. Всё остальное выключено намеренно: запись экрана
            // сняла бы планы квартир и адреса, а автозахват кликов утащил бы названия проектов —
            // ни того, ни другого мы людям не обещали, и в политике этого нет.
            disable_session_recording: true,
            disable_surveys: true,
            autocapture: false,
            capture_dead_clicks: false,
            capture_exceptions: false,
            person_profiles: 'never',
            advanced_disable_flags: true,
            disable_external_dependency_loading: true,
            save_referrer: false,
            save_campaign_params: false,
            persistence_name: 'domitsa_pilot_v1',
            ip: false,
            // SDK тоже получает только нейтральный адрес, а не URL квартиры или ссылки входа.
            get_current_url: () =>
              `https://domitsa.ru/analytics/${getPilotStage(window.location.pathname) ?? 'other'}`,
            before_send: (event) => sanitizePilotEvent(event, key, privacyAllowsTracking()),
            // Браузер, у которого включено «не отслеживать», не считаем вовсе. Политика обещает
            // человеку такую возможность, и обещание должно быть правдой.
            respect_dnt: true,
          })
          client = posthog
        }
        client.capture(PILOT_STAGE_EVENT, { stage, funnel_version: 1 })
      })
      .catch(() => {
        clientImport = null
        // Блокировщик или недоступный счётчик не должны мешать работе с квартирой.
      })
    return () => {
      active = false
    }
  }, [pathname])

  return null
}
