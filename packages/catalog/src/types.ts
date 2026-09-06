import type {
  CatalogAttributes,
  CatalogCategory,
  CatalogImage,
  CatalogSource,
  CatalogVariant,
} from '@uyut/db'

/** Товар после разбора любого фида: одна форма для CSV-дампа, YML Admitad и публичного поиска. */
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

export type FeedParseResult = { items: FeedItem[]; skipped: SkippedRow[] }

/** Источник фида: скачивает и разбирает. Реализации: CSV-дамп, YML Admitad, поиск Wildberries. */
export type FeedSource = {
  readonly source: CatalogSource
  load(): Promise<FeedParseResult>
}
