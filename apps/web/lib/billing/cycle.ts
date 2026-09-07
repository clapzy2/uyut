import { recordAudit } from '@/lib/audit'
import {
  getEmailSender,
  proChargedLetter,
  proChargeFailedLetter,
  proRenewalLetter,
} from '@/lib/email'
import { getEnv } from '@/lib/env'
import { getPaymentProvider } from '@/lib/payments'
import { applyPayment } from './apply'
import { MAX_CHARGE_ATTEMPTS, renewalStep } from './renewal'
import {
  activeProSubscription,
  attachPayment,
  createPurchase,
  expireSubscription,
  listRenewableSubscriptions,
  markChargeAttempt,
  markSubscriptionReminded,
  type RenewableSubscription,
} from './repository'

export type CycleReport = {
  checked: number
  charged: number
  failed: number
  reminded: number
  expired: number
}

function projectsUrl(): string {
  return new URL('/projects?renew=pro', getEnv().APP_URL).toString()
}

/**
 * Списание за следующий месяц. Попытка отмечается до обращения к провайдеру: если процесс
 * упадёт посередине, счётчик уже увеличен и завтрашний проход не начнёт всё заново без счёта.
 */
async function charge({ subscription, email }: RenewableSubscription, now: Date): Promise<boolean> {
  const method = subscription.yukassaSubscriptionId
  if (!method) {
    return false
  }
  const amountKopecks = getEnv().PRO_PRICE_KOPECKS
  await markChargeAttempt(subscription.id, now)
  const purchase = await createPurchase({
    userId: subscription.userId,
    kind: 'pro',
    projectId: null,
    amountKopecks,
  })
  const payment = await getPaymentProvider().chargeSaved({
    amountKopecks,
    description: 'Uyut Pro, один месяц',
    paymentMethodId: method,
    idempotencyKey: purchase.id,
    metadata: { purchaseId: purchase.id, kind: 'pro', userId: subscription.userId },
  })
  await attachPayment(purchase.id, payment.id)
  const applied = await applyPayment(payment.id)
  if (!applied.applied) {
    return false
  }
  const renewed = await activeProSubscription(subscription.userId)
  if (renewed?.currentPeriodEnd) {
    await getEmailSender().send({
      to: email,
      ...proChargedLetter({
        periodEnd: renewed.currentPeriodEnd,
        amountKopecks,
        manageUrl: new URL('/projects', getEnv().APP_URL).toString(),
      }),
    })
  }
  await recordAudit({
    action: 'billing.autopay_charged',
    actorId: subscription.userId,
    targetType: 'subscription',
    targetId: subscription.id,
    metadata: { paymentId: payment.id, amountKopecks },
  })
  return true
}

/** После последней неудачной попытки говорим прямо, что списать не вышло и что делать дальше */
async function reportChargeFailure(
  { subscription, email }: RenewableSubscription,
  now: Date,
): Promise<void> {
  const attemptsSpent = subscription.chargeAttempts + 1
  await recordAudit({
    action: 'billing.autopay_failed',
    actorId: subscription.userId,
    targetType: 'subscription',
    targetId: subscription.id,
    metadata: { attempt: attemptsSpent },
  })
  if (attemptsSpent < MAX_CHARGE_ATTEMPTS) {
    return
  }
  await getEmailSender().send({
    to: email,
    ...proChargeFailedLetter({
      periodEnd: subscription.currentPeriodEnd ?? now,
      renewUrl: projectsUrl(),
    }),
  })
}

/**
 * Дневной проход по подпискам: списывает за сутки до конца периода, напоминает письмом тем,
 * у кого автопродление выключено, и закрывает период, когда платить оказалось нечем.
 */
export async function runSubscriptionCycle(now = new Date()): Promise<CycleReport> {
  const rows = await listRenewableSubscriptions()
  const report: CycleReport = {
    checked: rows.length,
    charged: 0,
    failed: 0,
    reminded: 0,
    expired: 0,
  }

  for (const row of rows) {
    const { subscription, email } = row
    const step = renewalStep(subscription, now)
    try {
      switch (step) {
        case 'charge': {
          if (await charge(row, now)) {
            report.charged += 1
          } else {
            report.failed += 1
            await reportChargeFailure(row, now)
          }
          break
        }
        case 'remind': {
          const periodEnd = subscription.currentPeriodEnd
          if (periodEnd) {
            await getEmailSender().send({
              to: email,
              ...proRenewalLetter({ periodEnd, renewUrl: projectsUrl() }),
            })
            await markSubscriptionReminded(subscription.id, now)
            report.reminded += 1
          }
          break
        }
        case 'expire': {
          await expireSubscription(subscription.id)
          await recordAudit({
            action: 'billing.subscription_expired',
            actorId: subscription.userId,
            targetType: 'subscription',
            targetId: subscription.id,
          })
          report.expired += 1
          break
        }
        default:
          break
      }
    } catch (error) {
      // Одна сорвавшаяся подписка не должна оставить остальные без прохода
      console.error('subscription cycle step failed', subscription.id, error)
      report.failed += 1
      if (step === 'charge') {
        await reportChargeFailure(row, now).catch(() => undefined)
      }
    }
  }
  return report
}
