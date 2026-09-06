import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Next.js после ошибки в register() продолжает работать, поэтому выходим сами:
    // сервер с неверным окружением не должен принимать запросы
    const { getEnv } = await import('./lib/env')
    try {
      getEnv()
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
