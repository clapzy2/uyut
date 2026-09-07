import {
  type Purchase,
  type PurchaseKind,
  projects,
  purchases,
  type Subscription,
  type SubscriptionPlan,
  subscriptions,
  users,
} from '@uyut/db'
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUuid, NotFoundError } from '@/lib/projects/access'

/** Действующая подписка Pro: активна и период ещё не кончился */
export async function activeProSubscription(userId: string): Promise<Subscription | null> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.plan, 'pro'),
        eq(subscriptions.status, 'active'),
        gt(subscriptions.currentPeriodEnd, new Date()),
      ),
    )
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1)
  return row ?? null
}

export async function getPlan(userId: string): Promise<SubscriptionPlan> {
  return (await activeProSubscription(userId)) ? 'pro' : 'free'
}

export async function countProjects(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(projects)
    .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)))
  return row?.value ?? 0
}

export const PROJECT_LIMIT =
  'В бесплатном плане один проект. Второй и следующие открываются в Pro за 999 ₽ в месяц.'

/** Бесплатный план — один проект; второй и дальше только в Pro */
export async function canCreateProject(userId: string): Promise<boolean> {
  if ((await getPlan(userId)) === 'pro') {
    return true
  }
  return (await countProjects(userId)) === 0
}

export async function createPurchase(input: {
  userId: string
  kind: PurchaseKind
  projectId: string | null
  amountKopecks: number
}): Promise<Purchase> {
  const [row] = await getDb()
    .insert(purchases)
    .values({
      userId: input.userId,
      kind: input.kind,
      projectId: input.projectId,
      amountKopecks: input.amountKopecks,
      status: 'pending',
    })
    .returning()
  if (!row) {
    throw new Error('purchase insert returned nothing')
  }
  return row
}

export async function attachPayment(purchaseId: string, paymentId: string): Promise<void> {
  await getDb()
    .update(purchases)
    .set({ yukassaPaymentId: paymentId })
    .where(eq(purchases.id, purchaseId))
}

export async function getPurchase(userId: string, purchaseId: string): Promise<Purchase> {
  if (!isUuid(purchaseId)) {
    throw new NotFoundError('Платёж не найден')
  }
  const [row] = await getDb()
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)))
    .limit(1)
  if (!row) {
    throw new NotFoundError('Платёж не найден')
  }
  return row
}

export async function findPurchaseByPayment(paymentId: string): Promise<Purchase | null> {
  const [row] = await getDb()
    .select()
    .from(purchases)
    .where(eq(purchases.yukassaPaymentId, paymentId))
    .limit(1)
  return row ?? null
}

/**
 * Переводит покупку в paid ровно один раз: условие по статусу в самом update,
 * поэтому повторное уведомление или гонка возврата и webhook ничего не удвоят.
 */
export async function markPurchasePaid(purchaseId: string): Promise<boolean> {
  const rows = await getDb()
    .update(purchases)
    .set({ status: 'paid', paidAt: new Date() })
    .where(and(eq(purchases.id, purchaseId), eq(purchases.status, 'pending')))
    .returning({ id: purchases.id })
  return rows.length > 0
}

export async function markProjectPaid(projectId: string): Promise<void> {
  await getDb().update(projects).set({ isPaid: true }).where(eq(projects.id, projectId))
}

function addMonth(from: Date): Date {
  const next = new Date(from)
  next.setMonth(next.getMonth() + 1)
  return next
}

/** Месяц Pro: продлевает действующую подписку или заводит новую от сегодняшнего дня */
export async function activatePro(
  userId: string,
  paymentMethodId: string | null,
): Promise<Subscription> {
  const db = getDb()
  const current = await activeProSubscription(userId)
  if (current) {
    const [updated] = await db
      .update(subscriptions)
      .set({
        currentPeriodEnd: addMonth(current.currentPeriodEnd ?? new Date()),
        remindedAt: null,
        ...(paymentMethodId ? { yukassaSubscriptionId: paymentMethodId } : {}),
      })
      .where(eq(subscriptions.id, current.id))
      .returning()
    return updated ?? current
  }
  const [created] = await db
    .insert(subscriptions)
    .values({
      userId,
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: addMonth(new Date()),
      yukassaSubscriptionId: paymentMethodId,
    })
    .returning()
  if (!created) {
    throw new Error('subscription insert returned nothing')
  }
  return created
}

export async function userEmail(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.email ?? null
}
