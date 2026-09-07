import { logger, schedules } from '@trigger.dev/sdk'
import { subscriptions, users } from '@uyut/db'
import { and, eq, gt, isNull, lt, lte } from 'drizzle-orm'
import { db } from './lib/db'
import { optionalEnv } from './lib/env'
import { proRenewalLetter, sendMail } from './lib/mail'

const REMIND_DAYS_BEFORE = 3

/**
 * Автосписаний у подписки пока нет, поэтому раз в день: за три дня до конца периода — письмо
 * с кнопкой продления, после конца периода — статус past_due, чтобы план снова стал бесплатным.
 */
export const subscriptionReminders = schedules.task({
  id: 'subscription-reminders',
  cron: '0 9 * * *',
  maxDuration: 120,
  run: async () => {
    const database = db()
    const now = new Date()
    const soon = new Date(now.getTime() + REMIND_DAYS_BEFORE * 24 * 60 * 60 * 1000)
    const appUrl = (optionalEnv('APP_URL') ?? 'https://uyut.ru').replace(/\/$/, '')

    const expired = await database
      .update(subscriptions)
      .set({ status: 'past_due' })
      .where(
        and(
          eq(subscriptions.plan, 'pro'),
          eq(subscriptions.status, 'active'),
          lt(subscriptions.currentPeriodEnd, now),
        ),
      )
      .returning({ id: subscriptions.id })

    const ending = await database
      .select({ subscription: subscriptions, email: users.email })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(
        and(
          eq(subscriptions.plan, 'pro'),
          eq(subscriptions.status, 'active'),
          isNull(subscriptions.remindedAt),
          gt(subscriptions.currentPeriodEnd, now),
          lte(subscriptions.currentPeriodEnd, soon),
        ),
      )

    let reminded = 0
    for (const { subscription, email } of ending) {
      const periodEnd = subscription.currentPeriodEnd
      if (!periodEnd) {
        continue
      }
      try {
        const sent = await sendMail(
          email,
          proRenewalLetter({ periodEnd, renewUrl: `${appUrl}/projects?renew=pro` }),
        )
        if (sent) {
          await database
            .update(subscriptions)
            .set({ remindedAt: now })
            .where(eq(subscriptions.id, subscription.id))
          reminded += 1
        }
      } catch (error) {
        logger.warn('renewal letter failed', {
          subscriptionId: subscription.id,
          error: String(error),
        })
      }
    }

    logger.info('subscriptions checked', { expired: expired.length, reminded })
    return { expired: expired.length, reminded }
  },
})
