import { logger, schedules } from '@trigger.dev/sdk'
import { optionalEnv, requireEnv } from './lib/env'

/**
 * Само продление считает приложение: там живёт единственное место, где платёж становится фактом.
 * Задача только будит его раз в сутки, потому что расписаний в приложении нет.
 */
export const subscriptionsDaily = schedules.task({
  id: 'subscriptions-daily',
  cron: '0 9 * * *',
  maxDuration: 300,
  run: async () => {
    const secret = optionalEnv('CRON_SECRET')
    if (!secret) {
      logger.warn('CRON_SECRET не задан, проход по подпискам пропущен')
      return { skipped: true }
    }
    const appUrl = requireEnv('APP_URL').replace(/\/$/, '')
    const response = await fetch(`${appUrl}/api/cron/subscriptions`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(120_000),
    })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`проход по подпискам ответил ${response.status}: ${body.slice(0, 200)}`)
    }
    const report = JSON.parse(body) as Record<string, number>
    logger.info('subscriptions checked', report)
    return report
  },
})
