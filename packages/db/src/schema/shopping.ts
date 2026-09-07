import { index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { catalogItems, conceptObjects } from './catalog'
import { concepts } from './concepts'
import { projects, rooms } from './projects'

// Выбранный вариант товара: цвет из фида или свотч перекраски, если предмет перекрашивали
export type ShoppingVariant = {
  color?: string
  priceKopecks?: number
  affiliateUrl?: string
  swatchId?: string
}

// Один список покупок на проект, создаётся при первом «Добавить в список».
// concept_id из спеки оставлен для совместимости: главный концепт проекта, если он один.
export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('shopping_lists_project_idx').on(table.projectId)],
)

// Строка списка. Комната и предмет рендера нужны для группировки на странице итогов и в PDF;
// при удалении комнаты строка остаётся, просто теряет привязку.
export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => catalogItems.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    conceptObjectId: uuid('concept_object_id').references(() => conceptObjects.id, {
      onDelete: 'set null',
    }),
    quantity: integer('quantity').notNull().default(1),
    selectedVariant: jsonb('selected_variant').$type<ShoppingVariant>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('shopping_list_items_list_idx').on(table.listId)],
)

export type ShoppingList = typeof shoppingLists.$inferSelect
export type ShoppingListItem = typeof shoppingListItems.$inferSelect
export type NewShoppingListItem = typeof shoppingListItems.$inferInsert
