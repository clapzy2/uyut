import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { users } from './users'

export const projectRoles = ['owner', 'partner'] as const
export type ProjectRole = (typeof projectRoles)[number]

// Второй участник проекта. Владелец живёт в projects.owner_id и сюда не дублируется,
// поэтому строки здесь только с ролью partner, и в проекте она одна.
export const projectCollaborators = pgTable(
  'project_collaborators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: projectRoles }).notNull().default('partner'),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('project_collaborators_project_user_idx').on(table.projectId, table.userId),
    uniqueIndex('project_collaborators_one_partner_idx')
      .on(table.projectId)
      .where(sql`${table.role} = 'partner'`),
    index('project_collaborators_user_idx').on(table.userId),
  ],
)

// Приглашение живёт до того, как у адресата появился аккаунт: поэтому здесь почта, а не user_id.
// В базе хранится только хэш токена, сам токен уходит в письмо.
export const projectInvites = pgTable(
  'project_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('project_invites_project_idx').on(table.projectId)],
)

export type ProjectCollaborator = typeof projectCollaborators.$inferSelect
export type NewProjectCollaborator = typeof projectCollaborators.$inferInsert
export type ProjectInvite = typeof projectInvites.$inferSelect
export type NewProjectInvite = typeof projectInvites.$inferInsert
