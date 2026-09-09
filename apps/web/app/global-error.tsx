'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { fontVariables } from '@/lib/fonts'
import './globals.css'

/**
 * Отказ в корневом макете: своя разметка документа, поэтому стили и шрифты подключаются здесь.
 * Тему системную не переопределяем — переключатель живёт в макете, до которого дело не дошло.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="ru" className={fontVariables}>
      <body className="flex min-h-dvh flex-col font-sans">
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-12 sm:px-8">
          <div className="max-w-xl">
            <p className="font-serif text-[26px] leading-none tracking-tight text-ink">Домица</p>
            <h1 className="mt-8 font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl">
              Сервис не отвечает.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-2">
              Мы записали ошибку и уже смотрим. Ваши проекты сохранены, попробуйте открыть страницу
              заново через минуту.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-8 inline-flex h-11 items-center justify-center rounded-sm border border-accent bg-accent px-5 text-[15px] font-medium tracking-[0.01em] text-on-accent transition-colors duration-200 ease-ui hover:border-accent-hover hover:bg-accent-hover"
            >
              Попробовать снова
            </button>
            {error.digest ? (
              <p className="mt-10 font-mono text-[13px] text-ink-2">
                Код для поддержки: {error.digest}
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  )
}
