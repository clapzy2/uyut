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
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const roomKinds = ['living', 'bedroom', 'kitchen', 'bath', 'kid'] as const
export type RoomKind = (typeof roomKinds)[number]

export type Household = {
  adults?: number
  kids?: number
  pets?: boolean
  cookHome?: boolean
  receiveGuests?: boolean
  wfh?: boolean
}

// Одна квартира = один проект. Поля бюджета, семьи и стиля заполнит онбординг следующей фазы.
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
    household: jsonb('household').$type<Household>(),
    // Ключ объекта в приватном bucket, наружу отдаётся подписанной ссылкой
    planUrl: text('plan_url'),
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
    photoUrl: text('photo_url'),
    planUrl: text('plan_url'),
    notes: text('notes'),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [index('rooms_project_idx').on(table.projectId)],
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Room = typeof rooms.$inferSelect
export type NewRoom = typeof rooms.$inferInsert
