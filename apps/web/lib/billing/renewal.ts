import type { Subscription } from '@uyut/db'

const DAY = 24 * 60 * 60 * 1000
/** Списываем за сутки до конца периода, чтобы доступ не прерывался, пока платёж проходит */
const CHARGE_LEAD_MS = DAY
const REMIND_LEAD_MS = 3 * DAY
/** Одна попытка в сутки, даже если дневной проход запустили несколько раз подряд */
const CHARGE_COOLDOWN_MS = 12 * 60 * 60 * 1000

export const MAX_CHARGE_ATTEMPTS = 3

export type RenewalStep = 'charge' | 'remind' | 'expire' | 'skip'

export type RenewalState = Pick<
  Subscription,
  'currentPeriodEnd' | 'autoRenew' | 'yukassaSubscriptionId' | 'chargeAttempts' | 'lastChargeAt'
> & { remindedAt: Date | null }

/**
 * Что дневной проход делает с подпиской. Пока попытки списания не исчерпаны, подписка не
 * закрывается: карта могла быть временно недоступна, и следующий день — ещё один шанс.
 */
export function renewalStep(subscription: RenewalState, now: Date): RenewalStep {
  const end = subscription.currentPeriodEnd?.getTime()
  if (end === undefined) {
    return 'skip'
  }
  const endsIn = end - now.getTime()
  const willCharge = subscription.autoRenew && Boolean(subscription.yukassaSubscriptionId)
  const attemptsLeft = subscription.chargeAttempts < MAX_CHARGE_ATTEMPTS
  const chargedRecently =
    subscription.lastChargeAt !== null &&
    now.getTime() - subscription.lastChargeAt.getTime() < CHARGE_COOLDOWN_MS

  if (willCharge && attemptsLeft && endsIn <= CHARGE_LEAD_MS) {
    return chargedRecently ? 'skip' : 'charge'
  }
  if (endsIn <= 0) {
    return 'expire'
  }
  if (!willCharge && subscription.remindedAt === null && endsIn <= REMIND_LEAD_MS) {
    return 'remind'
  }
  return 'skip'
}
