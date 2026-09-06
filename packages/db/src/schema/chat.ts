import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const chatRoles = ['user', 'assistant', 'system'] as const
export type ChatRole = (typeof chatRoles)[number]

/** Карточки товаров и кнопка подтверждения внутри ответа помощника. */
export type ChatCard = {
  kind: 'product'
  catalogItemId: string
  title: string
  priceKopecks: number
  imageUrl: string | null
  affiliateUrl: string
  objectId?: string
}
export type ChatProposal = {
  kind: 'regeneration'
  roomId: string
  revision: string
  status: 'pending' | 'confirmed' | 'dismissed'
}
export type ChatMeta = { cards?: ChatCard[]; proposal?: ChatProposal; tools?: string[] }

// Один разговор на проект: история доступна с любой страницы проекта и после повторного входа
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role', { enum: chatRoles }).notNull(),
    content: text('content').notNull(),
    meta: jsonb('meta').$type<ChatMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chat_messages_project_idx').on(table.projectId, table.createdAt)],
)

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert
