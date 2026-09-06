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
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { concepts } from './concepts'
import { EMBEDDING_DIMENSIONS } from './embedding'

// Категории каталога в MVP. Один список на фиды, детектор и поиск.
export const catalogCategories = [
  'sofa',
  'chair',
  'table',
  'storage',
  'lamp',
  'rug',
  'bed',
  'decor',
] as const
export type CatalogCategory = (typeof catalogCategories)[number]

export const catalogSources = [
  'ozon',
  'wb',
  'ikea',
  'leroy',
  'divan',
  'hoff',
  'askona',
  'dump',
] as const
export type CatalogSource = (typeof catalogSources)[number]

export type CatalogImage = { url: string; alt?: string }
export type CatalogAttributes = {
  color?: string
  material?: string
  dimensionsCm?: { width?: number; depth?: number; height?: number }
}
export type CatalogVariant = { color?: string; priceKopecks?: number; affiliateUrl?: string }

// Каталог мебели из партнёрских фидов. Ключ уникальности — источник плюс внешний id,
// по нему идёт ежедневный upsert. Векторы считаются отдельной задачей для новых и изменённых
// записей, поэтому рядом лежит хеш содержимого.
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source', { enum: catalogSources }).notNull(),
    externalId: text('external_id').notNull(),
    category: text('category', { enum: catalogCategories }).notNull(),
    subcategory: text('subcategory'),
    brand: text('brand'),
    title: text('title').notNull(),
    description: text('description'),
    priceKopecks: bigint('price_kopecks', { mode: 'number' }).notNull(),
    oldPriceKopecks: bigint('old_price_kopecks', { mode: 'number' }),
    currency: text('currency').notNull().default('RUB'),
    affiliateUrl: text('affiliate_url').notNull(),
    images: jsonb('images').$type<CatalogImage[]>().notNull(),
    attributes: jsonb('attributes').$type<CatalogAttributes>(),
    variants: jsonb('variants').$type<CatalogVariant[]>(),
    inStock: boolean('in_stock').notNull().default(true),
    imageEmbedding: vector('image_embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    textEmbedding: vector('text_embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    // Хеш названия, описания и первой картинки: изменился — векторы пересчитываются
    contentHash: text('content_hash').notNull(),
    embeddedHash: text('embedded_hash'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('catalog_items_source_external_idx').on(table.source, table.externalId),
    index('catalog_items_category_idx').on(table.category).where(sql`${table.inStock} = true`),
    index('catalog_items_price_idx').on(table.priceKopecks).where(sql`${table.inStock} = true`),
    index('catalog_items_image_emb_idx')
      .using('ivfflat', table.imageEmbedding.op('vector_cosine_ops'))
      .with({ lists: 50 }),
  ],
)

export type ConceptBbox = { x: number; y: number; w: number; h: number }

// Предметы, найденные на рендере. Рамка хранится долями от ширины и высоты картинки,
// чтобы рисовать её поверх рендера любого размера.
export const conceptObjects = pgTable(
  'concept_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull().default(0),
    category: text('category', { enum: catalogCategories }).notNull(),
    // Подпись детектора как есть, для отладки словаря категорий
    label: text('label').notNull(),
    bbox: jsonb('bbox').$type<ConceptBbox>().notNull(),
    // Ключ маски SAM в приватном bucket
    maskUrl: text('mask_url'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    matchedCatalogItemId: uuid('matched_catalog_item_id').references(() => catalogItems.id, {
      onDelete: 'set null',
    }),
    matchedConfidence: numeric('matched_confidence', { precision: 3, scale: 2, mode: 'number' }),
    // Перекраска: какой свотч выбран и вектор вырезки в новом цвете, исходный вектор не трогаем
    swatchId: text('swatch_id'),
    editedEmbedding: vector('edited_embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('concept_objects_concept_idx').on(table.conceptId),
    index('concept_objects_embedding_idx')
      .using('ivfflat', table.embedding.op('vector_cosine_ops'))
      .with({ lists: 50 }),
  ],
)

export type CatalogItem = typeof catalogItems.$inferSelect
export type NewCatalogItem = typeof catalogItems.$inferInsert
export type ConceptObject = typeof conceptObjects.$inferSelect
export type NewConceptObject = typeof conceptObjects.$inferInsert
