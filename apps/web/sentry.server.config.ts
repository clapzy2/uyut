import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Живой канал обрывается каждый раз, когда человек закрывает вкладку или уходит со страницы:
  // это поведение браузера, а не сбой, и в списке ошибок оно только заслоняет настоящие
  ignoreErrors: ['ResponseAborted', 'The destination stream closed early'],
})
