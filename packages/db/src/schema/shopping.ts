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
    /**
     * Габариты со слов человека, когда в карточке магазина их нет.
     *
     * Живут у строки списка, а не у товара каталога: карточка общая для всех проектов,
     * и одно чужое число разъехалось бы по всем. У дивана размеров в фиде нет почти никогда —
     * из четырёхсот шестидесяти двух они нашлись у одного, — а без них вид сверху
     * про самый крупный предмет комнаты молчит.
     */
    dimensionsCm: jsonb('dimensions_cm').$type<ItemDimensionsCm>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('shopping_list_items_list_idx').on(table.listId)],
)

/** Ширина, глубина и высота в сантиметрах: тот же вид, что и в карточке каталога */
export type ItemDimensionsCm = { width?: number; depth?: number; height?: number }

export type ShoppingList = typeof shoppingLists.$inferSelect
export type ShoppingListItem = typeof shoppingListItems.$inferSelect
export type NewShoppingListItem = typeof shoppingListItems.$inferInsert
