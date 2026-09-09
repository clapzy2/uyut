import { logger, schedules } from '@trigger.dev/sdk'
import { optionalEnv, requireEnv } from './lib/env'

/**
 * Будит догоняющий проход по незакрытым покупкам. Сам проход живёт в приложении: там
 * единственное место, где платёж становится фактом, и разносить это по двум местам нельзя.
 *
 * Раз в четверть часа: уведомление от ЮKassa может не дойти, и человек, закрывший вкладку
 * сразу после оплаты, не должен ждать доступа сутки.
 */
export const paymentsSweep = schedules.task({
  id: 'payments-sweep',
  cron: '*/15 * * * *',
  maxDuration: 300,
  // Без повторов: клиент отваливается по таймауту раньше, чем проход в приложении
  // закончит работу, и повторный запуск шёл бы поверх ещё живого
  retry: { maxAttempts: 1 },
  run: async () => {
    const secret = optionalEnv('CRON_SECRET')
    if (!secret) {
      logger.warn('CRON_SECRET не задан, догоняющий проход пропущен')
      return { skipped: true }
    }
    const appUrl = requireEnv('APP_URL').replace(/\/$/, '')
    const response = await fetch(`${appUrl}/api/cron/payments`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(120_000),
    })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`догоняющий проход ответил ${response.status}: ${body.slice(0, 200)}`)
    }
    const report = JSON.parse(body) as Record<string, number>
    if (report.settled) {
      logger.info('pending payments settled', report)
    }
    return report
  },
})
