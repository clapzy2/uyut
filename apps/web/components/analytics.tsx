'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

type PostHog = {
  init: (key: string, options: Record<string, unknown>) => void
  capture: (event: string, properties?: Record<string, unknown>) => void
}

let client: PostHog | null = null

/**
 * Аналитика продукта. Библиотека грузится отдельным куском и только когда ключ задан:
 * без него сборка не тяжелеет, а приложение работает как раньше. Просмотры считаем сами,
 * потому что переходы между экранами идут без перезагрузки страницы.
 */
function Tracker() {
  const pathname = usePathname()
  const search = useSearchParams()
  const ready = useRef(false)

  useEffect(() => {
    if (!key || ready.current) {
      return
    }
    ready.current = true
    void import('posthog-js').then((module) => {
      const posthog = module.default as unknown as PostHog
      posthog.init(key, {
        api_host: host,
        capture_pageview: false,
        capture_pageleave: true,
        // Адреса содержат идентификаторы проектов и комнат, поэтому маскируем всё подряд
        mask_all_text: true,
        mask_all_element_attributes: true,
        person_profiles: 'identified_only',
      })
      client = posthog
      // Первый просмотр шлём здесь: библиотека грузится асинхронно и к моменту
      // монтирования второго эффекта её ещё нет
      client.capture('$pageview', { $current_url: window.location.href })
    })
  }, [])

  useEffect(() => {
    if (!client) {
      return
    }
    const query = search.toString()
    client.capture('$pageview', {
      $current_url: `${window.location.origin}${pathname}${query ? `?${query}` : ''}`,
    })
  }, [pathname, search])

  return null
}

export function Analytics() {
  if (!key) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  )
}
