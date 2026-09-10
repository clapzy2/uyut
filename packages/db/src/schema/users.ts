import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Форма таблицы совместима с Better Auth: id генерирует база, email_verified булев.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  role: text('role', { enum: ['user', 'admin'] })
    .notNull()
    .default('user'),
  // Согласие на обработку данных: закон возлагает на нас обязанность доказать, что оно было.
  // Раньше галочка проверялась только в браузере и нигде не сохранялась — доказывать было нечем.
  consentAcceptedAt: timestamp('consent_accepted_at', { withTimezone: true }),
  /** Редакция документов, действовавшая в момент согласия */
  consentVersion: text('consent_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
