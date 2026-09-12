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
  checkFit,
  type FitVerdict,
  footprintCm,
  type RoomLimits,
  type RoomSpot,
} from './fit'
export {
  CHAIR_PULLOUT_CM,
  COFFEE_CLEARANCE_CM,
  type LayoutItem,
  type LayoutProblem,
  type LayoutWall,
  layoutRoom,
  type Placement,
  type RoomLayout,
  WALKWAY_CM,
} from './layout'
export { isBathroomFixture, isForeignListing, isNotFurniture } from './not-furniture'
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
export {
  type CatalogSubcategory,
  subcategoryForLabel,
  subcategoryFromText,
} from './subcategories'
export type { FeedItem, FeedParseResult, FeedSource, SkippedRow } from './types'
export { parseYml } from './yml'
