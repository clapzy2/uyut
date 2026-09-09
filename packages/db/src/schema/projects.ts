import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { EMBEDDING_DIMENSIONS } from './embedding'
import { users } from './users'

export const roomKinds = ['living', 'bedroom', 'kitchen', 'bath', 'kid'] as const
export type RoomKind = (typeof roomKinds)[number]

// Черновая отделка или готовый ремонт: от этого зависит, просит ли промпт сделать ремонт
export const roomConditions = ['bare', 'finished'] as const
export type RoomCondition = (typeof roomConditions)[number]

export type Household = {
  adults?: number
  kids?: number
  pets?: boolean
  cookHome?: boolean
  receiveGuests?: boolean
  wfh?: boolean
}

/** Данные для PDF, вводятся один раз при экспорте и попадают в документ только по галочкам */
export type ProjectContact = {
  clientName?: string
  address?: string
  phone?: string
}

// Одна квартира = один проект. Бюджет, состав семьи и вкус заполняет онбординг.
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    houseSeries: text('house_series'),
    totalAreaM2: numeric('total_area_m2', { precision: 6, scale: 2, mode: 'number' }),
    budgetKopecks: bigint('budget_kopecks', { mode: 'number' }),
    styleTags: text('style_tags').array().notNull().default(sql`'{}'::text[]`),
    // Усреднённый вектор лайкнутых картинок стиля, смешанный с референсом пользователя
    styleReferenceEmbedding: vector('style_reference_embedding', {
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    household: jsonb('household').$type<Household>(),
    contact: jsonb('contact').$type<ProjectContact>(),
    // Ключи объектов в приватном bucket, наружу отдаются подписанной ссылкой
    planUrl: text('plan_url'),
    referenceUrl: text('reference_url'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    isPaid: boolean('is_paid').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('projects_owner_idx').on(table.ownerId).where(sql`${table.deletedAt} is null`)],
)

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: roomKinds }).notNull(),
    name: text('name').notNull(),
    areaM2: numeric('area_m2', { precision: 6, scale: 2, mode: 'number' }),
    condition: text('condition', { enum: roomConditions }).notNull().default('bare'),
    // Для комнаты с готовой отделкой: заказчик всё же хочет обновить чистовую, смета это учитывает
    refreshFinish: boolean('refresh_finish').notNull().default(false),
    photoUrl: text('photo_url'),
    planUrl: text('plan_url'),
    notes: text('notes'),
    orderIndex: integer('order_index').notNull().default(0),
    // Идущая генерация концептов. Живёт у комнаты, а не в состоянии страницы: иначе обновление
    // теряет ожидание целиком, и человек видит экран так, будто ничего не запускал.
    generationRunId: text('generation_run_id'),
    generationStartedAt: timestamp('generation_started_at', { withTimezone: true }),
    // Запуск этого прогона: по нему видно, готовы ли уже его концепты. Без него не отличить
    // «строки ещё не созданы» от «давно готовы», а это разные экраны.
    generationBatchId: uuid('generation_batch_id'),
  },
  (table) => [index('rooms_project_idx').on(table.projectId)],
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Room = typeof rooms.$inferSelect
export type NewRoom = typeof rooms.$inferInsert
