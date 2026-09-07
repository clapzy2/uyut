import { describe, expect, it } from 'vitest'
import { MAX_CHARGE_ATTEMPTS, type RenewalState, renewalStep } from './renewal'

const now = new Date('2026-09-07T09:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function subscription(patch: Partial<RenewalState> = {}): RenewalState {
  return {
    currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
    autoRenew: true,
    yukassaSubscriptionId: 'pm_saved',
    chargeAttempts: 0,
    lastChargeAt: null,
    remindedAt: null,
    ...patch,
  }
}

describe('renewal step of the daily pass', () => {
  it('leaves a subscription alone in the middle of its period', () => {
    expect(renewalStep(subscription(), now)).toBe('skip')
    expect(renewalStep(subscription({ currentPeriodEnd: null }), now)).toBe('skip')
  })

  it('charges a day before the period ends so access never lapses', () => {
    const endsTomorrow = new Date(now.getTime() + 20 * 60 * 60 * 1000)
    expect(renewalStep(subscription({ currentPeriodEnd: endsTomorrow }), now)).toBe('charge')
    expect(
      renewalStep(subscription({ currentPeriodEnd: new Date(now.getTime() + 2 * DAY) }), now),
    ).toBe('skip')
  })

  it('waits for the next day instead of charging twice', () => {
    const state = subscription({
      currentPeriodEnd: new Date(now.getTime() - DAY),
      chargeAttempts: 1,
      lastChargeAt: new Date(now.getTime() - 60 * 60 * 1000),
    })
    expect(renewalStep(state, now)).toBe('skip')
    expect(
      renewalStep({ ...state, lastChargeAt: new Date(now.getTime() - 20 * 60 * 60 * 1000) }, now),
    ).toBe('charge')
  })

  it('keeps retrying past the end date until the attempts run out', () => {
    const overdue = subscription({ currentPeriodEnd: new Date(now.getTime() - 2 * DAY) })
    expect(renewalStep({ ...overdue, chargeAttempts: MAX_CHARGE_ATTEMPTS - 1 }, now)).toBe('charge')
    expect(renewalStep({ ...overdue, chargeAttempts: MAX_CHARGE_ATTEMPTS }, now)).toBe('expire')
  })

  it('reminds by letter when nothing will be charged', () => {
    const endsSoon = new Date(now.getTime() + 2 * DAY)
    expect(renewalStep(subscription({ currentPeriodEnd: endsSoon, autoRenew: false }), now)).toBe(
      'remind',
    )
    // Способ оплаты не сохранён: списать нечем, значит тоже письмо
    expect(
      renewalStep(subscription({ currentPeriodEnd: endsSoon, yukassaSubscriptionId: null }), now),
    ).toBe('remind')
    // Второй раз за период не напоминаем
    expect(
      renewalStep(
        subscription({ currentPeriodEnd: endsSoon, autoRenew: false, remindedAt: now }),
        now,
      ),
    ).toBe('skip')
  })

  it('closes the period when the manual renewal never came', () => {
    const state = subscription({
      currentPeriodEnd: new Date(now.getTime() - DAY),
      autoRenew: false,
      remindedAt: new Date(now.getTime() - 4 * DAY),
    })
    expect(renewalStep(state, now)).toBe('expire')
  })
})
