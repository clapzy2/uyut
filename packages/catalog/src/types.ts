import type {
  CatalogAttributes,
  CatalogCategory,
  CatalogImage,
  CatalogSource,
  CatalogVariant,
} from '@uyut/db'

/** Товар после разбора любого фида: одна форма для CSV-дампа, CSV/YML Admitad и поиска. */
export type FeedItem = {
  source: CatalogSource
  externalId: string
  category: CatalogCategory
  subcategory?: string
  brand?: string
  title: string
  description?: string
  priceKopecks: number
  oldPriceKopecks?: number
  affiliateUrl: string
  images: CatalogImage[]
  attributes?: CatalogAttributes
  variants?: CatalogVariant[]
  inStock: boolean
}

export type SkippedRow = { reason: string; externalId?: string; title?: string }

export type FeedParseResult = {
  items: FeedItem[]
  skipped: SkippedRow[]
  /** Точное число пропусков, если потоковый разбор ограничил диагностическую выборку. */
  skippedCount?: number
}

/** Источник фида: скачивает и разбирает. Реализации: CSV-дамп, CSV/YML Admitad, поиск. */
export type FeedSource = {
  readonly source: CatalogSource
  load(): Promise<FeedParseResult>
}
