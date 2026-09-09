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
  listStalePendingPurchases,
  markChargeAttempt,
  markSubscriptionReminded,
  openProPurchase,
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
 * Списание за следующий месяц.
 *
 * Попытка отмечается до обращения к провайдеру: если процесс упадёт посередине, счётчик уже
 * увеличен и завтрашний проход не начнёт всё заново без счёта. Удачное списание сбрасывает
 * счётчик обратно, так что подхваченная попытка ничего не стоит.
 *
 * Незакрытая покупка не бросается, а продолжается: её номер служит ключом идемпотентности,
 * и по нему провайдер вернёт тот же платёж вместо второго списания. Новая покупка на повтор
 * означала бы новый ключ — и деньги ушли бы дважды.
 */
async function charge({ subscription, email }: RenewableSubscription, now: Date): Promise<boolean> {
  const method = subscription.yukassaSubscriptionId
  if (!method) {
    return false
  }
  const amountKopecks = getEnv().PRO_PRICE_KOPECKS
  await markChargeAttempt(subscription.id, now)

  const open = await openProPurchase(subscription.userId)
  // Ответ прошлой попытки мог потеряться уже после списания: сначала спрашиваем провайдера
  if (open?.yukassaPaymentId) {
    const settled = await applyPayment(open.yukassaPaymentId)
    if (settled.applied) {
      await announceCharge(subscription.userId, email, amountKopecks, open.yukassaPaymentId)
      return true
    }
  }

  const purchase =
    open ??
    (await createPurchase({
      userId: subscription.userId,
      kind: 'pro',
      projectId: null,
      amountKopecks,
    }))
  const payment = await getPaymentProvider().chargeSaved({
    amountKopecks,
    description: 'Домица Pro, один месяц',
    paymentMethodId: method,
    idempotencyKey: purchase.id,
    metadata: { purchaseId: purchase.id, kind: 'pro', userId: subscription.userId },
  })
  if (payment.id !== purchase.yukassaPaymentId) {
    await attachPayment(purchase.id, payment.id)
  }
  const applied = await applyPayment(payment.id)
  if (!applied.applied) {
    return false
  }
  await announceCharge(subscription.userId, email, amountKopecks, payment.id)
  return true
}

/** Письмо о списании и запись в аудит: общий хвост обоих путей, и обычного, и подхваченного */
async function announceCharge(
  userId: string,
  email: string,
  amountKopecks: number,
  paymentId: string,
): Promise<void> {
  const renewed = await activeProSubscription(userId)
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
    actorId: userId,
    targetType: 'subscription',
    targetId: renewed?.id ?? userId,
    metadata: { paymentId, amountKopecks },
  })
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

export type SweepReport = { checked: number; settled: number; stillPending: number }

/**
 * Догоняющий проход по незакрытым покупкам.
 *
 * Уведомление от ЮKassa может не дойти — неверный адрес в кабинете, отказ по адресу
 * отправителя, простой дольше суток, — и тогда человек, закрывший вкладку, останется
 * без доступа при списанных деньгах. Здесь мы перечитываем такие платежи у провайдера сами.
 *
 * Ничего нового не выдаёт: вся работа идёт через ту же applyPayment, а она идемпотентна.
 */
export async function sweepPendingPurchases(now = new Date()): Promise<SweepReport> {
  const stale = await listStalePendingPurchases(now)
  const report: SweepReport = { checked: stale.length, settled: 0, stillPending: 0 }
  for (const purchase of stale) {
    try {
      const applied = await applyPayment(purchase.paymentId)
      if (applied.applied) {
        report.settled += 1
      } else {
        report.stillPending += 1
      }
    } catch (error) {
      // Один неотвечающий платёж не должен оставить остальные без проверки
      console.error('pending purchase sweep failed', purchase.id, error)
      report.stillPending += 1
    }
  }
  return report
}
