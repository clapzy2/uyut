// Разбор партнёрских фидов, хранение каталога и поиск похожих товаров.

export { categoryFromText, isCatalogCategory } from './categories'
export { parseCsv, parseCsvDump, parseRubles } from './csv'
export { type DimensionsCm, hasAnyDimension, parseDimensionsCm } from './dimensions'
export {
  type Estimate,
  type EstimateItem,
  type EstimateRoom,
  estimateProject,
  itemTotalKopecks,
  type RoomWorks,
  type RoomWorksKind,
  type WorksRates,
} from './estimate'
export {
  contentHash,
  countItems,
  findSimilar,
  getCatalogItems,
  itemsNeedingEmbedding,
  markMissingOutOfStock,
  type SimilarItem,
  type SimilarQuery,
  saveEmbeddings,
  type UpsertSummary,
  upsertFeedItems,
} from './repository'
export type { FeedItem, FeedParseResult, FeedSource, SkippedRow } from './types'
export { parseYml } from './yml'
