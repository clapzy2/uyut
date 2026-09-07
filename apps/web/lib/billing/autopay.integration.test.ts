import { randomUUID } from 'node:crypto'
import { purchases, subscriptions, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '@/lib/email'
import { createFakePaymentProvider } from '@/lib/payments/fake-provider'
import { isYooKassaAddress } from '@/lib/payments/yookassa'

const provider = createFakePaymentProvider(0)
vi.mock('@/lib/payments', () => ({
  getPaymentProvider: () => provider,
  isYooKassaAddress,
}))

// Письма перехватываем: проверяем не доставку, а то, какое из них ушло и кому
const sent: EmailMessage[] = []
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return {
    ...actual,
    getEmailSender: () => ({
      send: async (message: EmailMessage) => {
        sent.push(message)
      },
    }),
  }
})

const { runSubscriptionCycle } = await import('@/lib/billing/cycle')
const { setAutoRenew } = await import('@/lib/billing/repository')
const { getDb } = await import('@/lib/db')

const DAY = 24 * 60 * 60 * 1000
const run = randomUUID().slice(0, 8)
const userIds: string[] = []

async function createSubscriber(patch: {
  autoRenew: boolean
  yukassaSubscriptionId: string | null
  currentPeriodEnd: Date
  chargeAttempts?: number
}): Promise<{ userId: string; email: string; subscriptionId: string }> {
  const db = getDb()
  const email = `it-autopay-${run}-${userIds.length}@example.test`
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id })
  const userId = user?.id ?? ''
  userIds.push(userId)
  const [subscription] = await db
    .insert(subscriptions)
    .values({ userId, plan: 'pro', status: 'active', ...patch })
    .returning({ id: subscriptions.id })
  return { userId, email, subscriptionId: subscription?.id ?? '' }
}

function lettersFor(email: string): string[] {
  return sent.filter((message) => message.to === email).map((message) => message.subject)
}

describe('daily subscription pass in a real database', () => {
  beforeAll(() => {
    sent.length = 0
  })

  afterAll(async () => {
    const db = getDb()
    for (const userId of userIds) {
      await db.delete(purchases).where(eq(purchases.userId, userId))
      await db.delete(subscriptions).where(eq(subscriptions.userId, userId))
      await db.delete(users).where(eq(users.id, userId))
    }
  })

  it('charges the saved card a day before the period ends and extends it by a month', async () => {
    const endsIn20Hours = new Date(Date.now() + 20 * 60 * 60 * 1000)
    const { userId, email, subscriptionId } = await createSubscriber({
      autoRenew: true,
      yukassaSubscriptionId: 'fake_pm_saved',
      currentPeriodEnd: endsIn20Hours,
    })

    await runSubscriptionCycle()

    const [renewed] = await getDb()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
    expect(renewed?.status).toBe('active')
    expect((renewed?.currentPeriodEnd?.getTime() ?? 0) - endsIn20Hours.getTime()).toBeGreaterThan(
      27 * DAY,
    )
    // Успешное списание обнуляет счётчик неудач, иначе третий месяц уже не спишется
    expect(renewed?.chargeAttempts).toBe(0)

    const paid = await getDb().select().from(purchases).where(eq(purchases.userId, userId))
    expect(paid).toHaveLength(1)
    expect(paid[0]?.status).toBe('paid')
    expect(paid[0]?.kind).toBe('pro')
    expect(lettersFor(email)).toEqual(['Pro в Uyut продлён на месяц'])
  })

  it('does not charge the same subscription twice in one day', async () => {
    const { userId } = await createSubscriber({
      autoRenew: true,
      yukassaSubscriptionId: 'fake_pm_twice',
      currentPeriodEnd: new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
    await runSubscriptionCycle()
    await runSubscriptionCycle()
    const paid = await getDb().select().from(purchases).where(eq(purchases.userId, userId))
    expect(paid).toHaveLength(1)
  })

  it('writes a letter instead of charging when auto renewal is off', async () => {
    const { email, subscriptionId } = await createSubscriber({
      autoRenew: false,
      yukassaSubscriptionId: 'fake_pm_manual',
      currentPeriodEnd: new Date(Date.now() + 2 * DAY),
    })

    await runSubscriptionCycle()
    // Второй проход в тот же период письмо не повторяет
    await runSubscriptionCycle()

    const [reminded] = await getDb()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
    expect(reminded?.remindedAt).not.toBeNull()
    expect(lettersFor(email)).toEqual([expect.stringContaining('Pro в Uyut заканчивается')])
  })

  it('closes a period nobody paid for', async () => {
    const { subscriptionId } = await createSubscriber({
      autoRenew: false,
      yukassaSubscriptionId: null,
      currentPeriodEnd: new Date(Date.now() - DAY),
    })
    await runSubscriptionCycle()
    const [expired] = await getDb()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
    expect(expired?.status).toBe('past_due')
  })

  it('refuses to turn auto renewal on without a saved card', async () => {
    const { userId } = await createSubscriber({
      autoRenew: false,
      yukassaSubscriptionId: null,
      currentPeriodEnd: new Date(Date.now() + 10 * DAY),
    })
    await expect(setAutoRenew(userId, true)).rejects.toThrow(/карты/)
    const enabled = await createSubscriber({
      autoRenew: false,
      yukassaSubscriptionId: 'fake_pm_switch',
      currentPeriodEnd: new Date(Date.now() + 10 * DAY),
    })
    expect((await setAutoRenew(enabled.userId, true)).autoRenew).toBe(true)
    expect((await setAutoRenew(enabled.userId, false)).autoRenew).toBe(false)
  })
})
