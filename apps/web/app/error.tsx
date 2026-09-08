'use client'

import * as Sentry from '@sentry/nextjs'
import { Button } from '@uyut/ui'
import Link from 'next/link'
import { useEffect } from 'react'
import { isStaleBuildError, shouldReloadOnce } from '@/lib/errors/stale-build'

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Вкладку, открытую до выкатки, чинит обычная перезагрузка: имена файлов сборки сменились.
    // Показывать человеку экран ошибки там, где достаточно обновить страницу, — обманывать его.
    if (isStaleBuildError(error) && shouldReloadOnce()) {
      window.location.reload()
      return
    }
    Sentry.captureException(error)
  }, [error])

  return (
    <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-24">
      <div className="max-w-xl">
        <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
          Страница не открылась.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-2">
          Это наша ошибка, а не ваша: мы её записали и разберёмся. Проект и всё, что в нём есть, на
          месте.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button onClick={reset}>Попробовать снова</Button>
          <Link
            href="/projects"
            className="inline-block py-1.5 text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
          >
            К проектам
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-10 font-mono text-[13px] text-ink-2">
            Код для поддержки: {error.digest}
          </p>
        ) : null}
      </div>
    </section>
  )
}
