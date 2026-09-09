import {
  type Database,
  type Purchase,
  type PurchaseKind,
  projects,
  purchases,
  type Subscription,
  type SubscriptionPlan,
  subscriptions,
  users,
} from '@uyut/db'
import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUuid, NotFoundError } from '@/lib/projects/access'

/**
 * Исполнитель запроса: либо база целиком, либо открытая транзакция. Выдача доступа идёт
 * внутри транзакции, а обычные чтения — снаружи, и условие у них должно быть общим.
 */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Условие «действующая подписка Pro»: активна и период ещё не кончился */
function activeProWhere(userId: string) {
  return and(
    eq(subscriptions.userId, userId),
    eq(subscriptions.plan, 'pro'),
    eq(subscriptions.status, 'active'),
    gt(subscriptions.currentPeriodEnd, new Date()),
  )
}

/** Действующая подписка Pro: активна и период ещё не кончился */
export async function activeProSubscription(userId: string): Promise<Subscription | null> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(activeProWhere(userId))
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
 * Отметка об оплате и выдача доступа одной транзакцией.
 *
 * Раздельно этого делать нельзя. Отметка ставится условием по статусу, то есть срабатывает
 * ровно один раз; если выдача после неё упадёт — обрыв к базе, перезапуск контейнера, — покупка
 * навсегда останется оплаченной без доступа, и повторное уведомление уже не поможет: оно увидит
 * отметку и выйдет раньше выдачи. Деньги списаны, тариф не выдан, и починить нечем.
 *
 * Возвращает true, если доступ выдан именно этим вызовом. Повторный вызов вернёт false, поэтому
 * webhook, возврат на сайт и повторные уведомления безопасно зовут это сколько угодно раз.
 *
 * В транзакции нет ни одного обращения по сети: ни к провайдеру, ни к очереди, ни к почте —
 * иначе чужой таймаут держал бы строки заблокированными.
 */
export async function settlePurchasePaid(
  purchase: Purchase,
  paymentMethodId: string | null,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .update(purchases)
      .set({ status: 'paid', paidAt: new Date() })
      .where(and(eq(purchases.id, purchase.id), eq(purchases.status, 'pending')))
      .returning({ id: purchases.id })
    if (rows.length === 0) {
      return false
    }
    if (purchase.kind === 'project' && purchase.projectId) {
      await tx.update(projects).set({ isPaid: true }).where(eq(projects.id, purchase.projectId))
    } else {
      await activateProWith(tx, purchase.userId, paymentMethodId)
    }
    return true
  })
}

function addMonth(from: Date): Date {
  const next = new Date(from)
  next.setMonth(next.getMonth() + 1)
  return next
}

/**
 * Месяц Pro внутри уже открытой транзакции: продлевает действующую подписку или заводит новую.
 * Чтение подписки идёт тем же исполнителем, что и запись, иначе внутри транзакции можно
 * увидеть состояние до неё и продлить дважды.
 */
async function activateProWith(
  db: Transaction,
  userId: string,
  paymentMethodId: string | null,
): Promise<Subscription> {
  const [current] = await db
    .select()
    .from(subscriptions)
    .where(activeProWhere(userId))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1)
  if (current) {
    const [updated] = await db
      .update(subscriptions)
      .set({
        currentPeriodEnd: addMonth(current.currentPeriodEnd ?? new Date()),
        remindedAt: null,
        chargeAttempts: 0,
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
      // Первая оплата Pro идёт с согласием на ежемесячное списание; отключается в любой момент
      autoRenew: paymentMethodId !== null,
    })
    .returning()
  if (!created) {
    throw new Error('subscription insert returned nothing')
  }
  return created
}

/** Месяц Pro отдельным вызовом: своя транзакция на одну выдачу */
export async function activatePro(
  userId: string,
  paymentMethodId: string | null,
): Promise<Subscription> {
  return getDb().transaction((tx) => activateProWith(tx, userId, paymentMethodId))
}

/**
 * Покупки, за которые, возможно, уже заплачено, а мы об этом не знаем.
 *
 * Уведомление от ЮKassa может не дойти: неверный адрес в кабинете, ложный отказ по адресу
 * отправителя, простой дольше суток. Если человек при этом закрыл вкладку и не вернулся по
 * ссылке с ?payment=, покупка останется висеть навсегда, а деньги уйдут молча. Догоняющий
 * проход перечитывает такие платежи у провайдера сам.
 *
 * Окно снизу — десять минут: раньше человек ещё может стоять на странице банка. Сверху трое
 * суток: платёж у ЮKassa к этому времени закрыт, и дёргать по нему API незачем.
 */
export async function listStalePendingPurchases(
  now: Date,
  limit = 100,
): Promise<Array<{ id: string; paymentId: string }>> {
  const rows = await getDb()
    .select({ id: purchases.id, paymentId: purchases.yukassaPaymentId })
    .from(purchases)
    .where(
      and(
        eq(purchases.status, 'pending'),
        isNotNull(purchases.yukassaPaymentId),
        lt(purchases.createdAt, new Date(now.getTime() - 10 * 60_000)),
        gt(purchases.createdAt, new Date(now.getTime() - 3 * 24 * 60 * 60_000)),
      ),
    )
    .orderBy(asc(purchases.createdAt))
    .limit(limit)
  return rows.flatMap((row) => (row.paymentId ? [{ id: row.id, paymentId: row.paymentId }] : []))
}

/** Незакрытая покупка Pro этого человека: с неё начинается попытка автосписания */
export async function pendingProPurchase(
  userId: string,
): Promise<{ id: string; paymentId: string } | null> {
  const [row] = await getDb()
    .select({ id: purchases.id, paymentId: purchases.yukassaPaymentId })
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.kind, 'pro'),
        eq(purchases.status, 'pending'),
        isNotNull(purchases.yukassaPaymentId),
      ),
    )
    .orderBy(desc(purchases.createdAt))
    .limit(1)
  return row?.paymentId ? { id: row.id, paymentId: row.paymentId } : null
}

export async function userEmail(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.email ?? null
}

export type RenewableSubscription = { subscription: Subscription; email: string }

/** Все действующие подписки Pro с почтой владельца: дневной проход решает по каждой сам */
export async function listRenewableSubscriptions(): Promise<RenewableSubscription[]> {
  return getDb()
    .select({ subscription: subscriptions, email: users.email })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(eq(subscriptions.plan, 'pro'), eq(subscriptions.status, 'active')))
}

export async function markSubscriptionReminded(id: string, at: Date): Promise<void> {
  await getDb().update(subscriptions).set({ remindedAt: at }).where(eq(subscriptions.id, id))
}

/** Попытка списания зафиксирована до обращения к провайдеру: иначе сбой обнулит счётчик */
export async function markChargeAttempt(id: string, at: Date): Promise<void> {
  await getDb()
    .update(subscriptions)
    .set({ chargeAttempts: sql`${subscriptions.chargeAttempts} + 1`, lastChargeAt: at })
    .where(eq(subscriptions.id, id))
}

export async function expireSubscription(id: string): Promise<void> {
  await getDb().update(subscriptions).set({ status: 'past_due' }).where(eq(subscriptions.id, id))
}

export const NO_SAVED_METHOD =
  'Автопродление включится после следующей оплаты: сохранённой карты пока нет.'

export async function setAutoRenew(userId: string, enabled: boolean): Promise<Subscription> {
  const current = await activeProSubscription(userId)
  if (!current) {
    throw new NotFoundError('Подписка не найдена')
  }
  if (enabled && !current.yukassaSubscriptionId) {
    throw new NotFoundError(NO_SAVED_METHOD)
  }
  const [updated] = await getDb()
    .update(subscriptions)
    .set({ autoRenew: enabled, ...(enabled ? { chargeAttempts: 0 } : {}) })
    .where(eq(subscriptions.id, current.id))
    .returning()
  return updated ?? current
}
