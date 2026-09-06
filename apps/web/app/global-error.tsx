'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="ru">
      <body>
        <main className="grid min-h-dvh place-items-center">
          <p>Страница не открылась. Попробуйте обновить её через минуту.</p>
        </main>
      </body>
    </html>
  )
}
