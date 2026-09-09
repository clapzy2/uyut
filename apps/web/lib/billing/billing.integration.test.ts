import { randomUUID } from 'node:crypto'
import { projects, purchases, subscriptions, users } from '@uyut/db'
import { desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createFakePaymentProvider } from '@/lib/payments/fake-provider'
import { isYooKassaAddress } from '@/lib/payments/yookassa'

// Один фейковый провайдер на весь файл: платежи живут в его памяти между шагами теста
const provider = createFakePaymentProvider(0)
vi.mock('@/lib/payments', () => ({
  getPaymentProvider: () => provider,
  isYooKassaAddress,
}))

const { applyPayment } = await import('@/lib/billing/apply')
const {
  activatePro,
  attachPayment,
  canCreateProject,
  createPurchase,
  getPlan,
  settlePurchasePaid,
} = await import('@/lib/billing/repository')
const { POST } = await import('@/app/api/webhooks/yukassa/route')
const { getDb } = await import('@/lib/db')

const run = randomUUID().slice(0, 8)
let userId = ''
let projectId = ''

function notification(paymentId: string, ip = '185.71.76.10'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/yukassa', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: paymentId, status: 'succeeded' },
    }),
  })
}

describe('billing in a real database', () => {
  beforeAll(async () => {
    const db = getDb()
    const [user] = await db
      .insert(users)
      .values({ email: `billing-${run}@example.test` })
      .returning({ id: users.id })
    userId = user?.id ?? ''
    const [project] = await db
      .insert(projects)
      .values({ ownerId: userId, title: `Оплата ${run}` })
      .returning({ id: projects.id })
    projectId = project?.id ?? ''
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(purchases).where(eq(purchases.userId, userId))
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId))
    await db.delete(projects).where(eq(projects.ownerId, userId))
    await db.delete(users).where(eq(users.id, userId))
  })

  it('marks the project paid once, no matter how many notifications arrive', async () => {
    const purchase = await createPurchase({
      userId,
      kind: 'project',
      projectId,
      amountKopecks: 150_000,
    })
    const payment = await provider.createPayment({
      amountKopecks: 150_000,
      description: 'test',
      returnUrl: 'http://localhost/return',
      idempotencyKey: purchase.id,
    })
    await attachPayment(purchase.id, payment.id)

    const first = await applyPayment(payment.id)
    expect(first.applied).toBe(true)
    expect(first.purchase?.status).toBe('paid')

    const second = await applyPayment(payment.id)
    expect(second.applied).toBe(false)
    expect(second.status).toBe('succeeded')

    // Webhook дважды подряд: покупка одна, статус не меняется
    const responses = await Promise.all([
      POST(notification(payment.id)),
      POST(notification(payment.id)),
    ])
    for (const response of responses) {
      expect(response.status).toBe(200)
    }
    const paid = await getDb().select().from(purchases).where(eq(purchases.userId, userId))
    expect(paid.filter((row) => row.status === 'paid')).toHaveLength(1)
    const [project] = await getDb()
      .select({ isPaid: projects.isPaid })
      .from(projects)
      .where(eq(projects.id, projectId))
    expect(project?.isPaid).toBe(true)
  })

  it('не оставляет оплату без выдачи, если выдача сорвалась', async () => {
    const purchase = await createPurchase({
      userId,
      kind: 'project',
      projectId,
      amountKopecks: 150_000,
    })
    // Проекта с таким номером нет, и это даже не UUID: запрос выдачи упадёт уже в Postgres.
    // Так проверяется главное: отметка об оплате откатывается вместе с несостоявшейся выдачей.
    const broken = { ...purchase, projectId: 'это-не-uuid' }

    await expect(settlePurchasePaid(broken, null)).rejects.toThrow()

    const [row] = await getDb().select().from(purchases).where(eq(purchases.id, purchase.id))
    expect(row?.status, 'покупка обязана остаться неоплаченной').toBe('pending')
    expect(row?.paidAt).toBeNull()
  })

  it('выдаёт доступ ровно один раз и не продлевает повторно', async () => {
    const db = getDb()
    // Свой пользователь: включённый Pro виден соседним проверкам и сбил бы их
    const [own] = await db
      .insert(users)
      .values({ email: `billing-once-${run}@example.test` })
      .returning({ id: users.id })
    const ownId = own?.id ?? ''
    try {
      const purchase = await createPurchase({
        userId: ownId,
        kind: 'pro',
        projectId: null,
        amountKopecks: 99_900,
      })
      expect(await settlePurchasePaid(purchase, null)).toBe(true)
      const [afterFirst] = await db
        .select({ periodEnd: subscriptions.currentPeriodEnd })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ownId))
        .orderBy(desc(subscriptions.currentPeriodEnd))
        .limit(1)

      expect(await settlePurchasePaid(purchase, null)).toBe(false)
      const rows = await db
        .select({ periodEnd: subscriptions.currentPeriodEnd })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ownId))
      expect(rows, 'вторая попытка не должна заводить ещё одну подписку').toHaveLength(1)
      expect(rows[0]?.periodEnd?.toISOString()).toBe(afterFirst?.periodEnd?.toISOString())
    } finally {
      await db.delete(purchases).where(eq(purchases.userId, ownId))
      await db.delete(subscriptions).where(eq(subscriptions.userId, ownId))
      await db.delete(users).where(eq(users.id, ownId))
    }
  })

  it('ignores notifications for unknown payments and rejects garbage', async () => {
    const unknown = await POST(notification('fake_missing'))
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toEqual({ ok: true, applied: false })
    const garbage = await POST(
      new NextRequest('http://localhost/api/webhooks/yukassa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"type":"notification"}',
      }),
    )
    expect(garbage.status).toBe(400)
  })

  it('refuses a payment whose amount differs from the purchase', async () => {
    const purchase = await createPurchase({
      userId,
      kind: 'pro',
      projectId: null,
      amountKopecks: 99_900,
    })
    const payment = await provider.createPayment({
      amountKopecks: 10_000,
      description: 'подмена суммы',
      returnUrl: 'http://localhost/return',
      idempotencyKey: purchase.id,
    })
    await attachPayment(purchase.id, payment.id)
    const result = await applyPayment(payment.id)
    expect(result.applied).toBe(false)
    expect(result.purchase?.status).toBe('pending')
  })

  it('activates Pro for a month and lifts the one-project limit', async () => {
    expect(await getPlan(userId)).toBe('free')
    expect(await canCreateProject(userId)).toBe(false)

    const purchase = await createPurchase({
      userId,
      kind: 'pro',
      projectId: null,
      amountKopecks: 99_900,
    })
    const payment = await provider.createPayment({
      amountKopecks: 99_900,
      description: 'Pro',
      returnUrl: 'http://localhost/return',
      idempotencyKey: purchase.id,
      savePaymentMethod: true,
    })
    await attachPayment(purchase.id, payment.id)
    const result = await applyPayment(payment.id)
    expect(result.applied).toBe(true)
    expect(await getPlan(userId)).toBe('pro')
    expect(await canCreateProject(userId)).toBe(true)

    const [subscription] = await getDb()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
    expect(subscription?.status).toBe('active')
    expect(subscription?.yukassaSubscriptionId).toMatch(/^fake_pm_/)
    const end = subscription?.currentPeriodEnd?.getTime() ?? 0
    expect(end).toBeGreaterThan(Date.now() + 27 * 24 * 60 * 60 * 1000)

    // Второй месяц продлевает срок, а не заводит вторую подписку
    const extended = await activatePro(userId, null)
    expect(extended.id).toBe(subscription?.id)
    expect((extended.currentPeriodEnd?.getTime() ?? 0) - end).toBeGreaterThan(
      27 * 24 * 60 * 60 * 1000,
    )
  })
})
