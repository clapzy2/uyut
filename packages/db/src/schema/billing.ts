import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { users } from './users'

export const subscriptionPlans = ['free', 'pro'] as const
export const subscriptionStatuses = ['active', 'canceled', 'past_due'] as const
export const purchaseStatuses = ['pending', 'paid', 'refunded'] as const
export const purchaseKinds = ['project', 'pro'] as const

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  plan: text('plan', { enum: subscriptionPlans }).notNull(),
  status: text('status', { enum: subscriptionStatuses }).notNull(),
  // Сохранённый способ оплаты ЮKassa: по нему списывается следующий месяц
  yukassaSubscriptionId: text('yukassa_subscription_id'),
  // Продлевать самим или ждать ручной оплаты; без сохранённого способа включить нельзя
  autoRenew: boolean('auto_renew').notNull().default(false),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  // Письмо о продлении ушло за этот период: повторно не шлём
  remindedAt: timestamp('reminded_at', { withTimezone: true }),
  // Неудачные попытки списания за текущий период и время последней: защита от повторов в один день
  chargeAttempts: integer('charge_attempts').notNull().default(0),
  lastChargeAt: timestamp('last_charge_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  // Разовая покупка проекта или месяц Pro; у месяца Pro проекта нет
  kind: text('kind', { enum: purchaseKinds }).notNull().default('project'),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
  yukassaPaymentId: text('yukassa_payment_id').unique(),
  status: text('status', { enum: purchaseStatuses }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Subscription = typeof subscriptions.$inferSelect
export type Purchase = typeof purchases.$inferSelect
export type SubscriptionPlan = (typeof subscriptionPlans)[number]
export type PurchaseStatus = (typeof purchaseStatuses)[number]
export type PurchaseKind = (typeof purchaseKinds)[number]
