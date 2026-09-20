import type { DimensionsCm } from '@uyut/catalog'
import type { CatalogAttributes } from '@uyut/db'

export type ItemSizeReading = {
  dimensionsCm: DimensionsCm | null
  source: 'user' | 'store-parameters' | 'store-text' | 'unknown'
  confidence: 'confirmed' | 'reported' | 'parsed' | 'unknown'
}

/**
 * Размеры строки списка: сперва вписанные человеком, потом из карточки магазина.
 *
 * У дивана в фиде габаритов почти никогда нет — из четырёхсот шестидесяти двух они нашлись
 * у одного, — а без них вид сверху молчит про самый крупный предмет комнаты. Поэтому человеку
 * дают вписать их самому, и его число главнее.
 */
export function effectiveSize(
  item: { dimensionsCm: DimensionsCm | null },
  product: { attributes: CatalogAttributes | null },
): DimensionsCm | null {
  return effectiveSizeReading(item, product).dimensionsCm
}

export function effectiveSizeReading(
  item: { dimensionsCm: DimensionsCm | null },
  product: { attributes: CatalogAttributes | null },
): ItemSizeReading {
  const own = item.dimensionsCm
  if (own && (own.width || own.depth || own.height)) {
    return { dimensionsCm: own, source: 'user', confidence: 'confirmed' }
  }
  const dimensionsCm = product.attributes?.dimensionsCm ?? null
  if (!dimensionsCm) {
    return { dimensionsCm: null, source: 'unknown', confidence: 'unknown' }
  }
  const recordedSources = Object.entries(product.attributes?.dimensionsSource ?? {})
    .filter(([key]) => dimensionsCm[key as keyof DimensionsCm] !== undefined)
    .map(([, source]) => source)
  const source =
    recordedSources.length > 0 && recordedSources.every((entry) => entry === 'store-parameters')
      ? 'store-parameters'
      : 'store-text'
  return {
    dimensionsCm,
    source,
    confidence: source === 'store-parameters' ? 'reported' : 'parsed',
  }
}

export function itemSizeSourceLabel(reading: ItemSizeReading): string | null {
  return {
    user: 'размеры введены вами',
    'store-parameters': 'размеры из характеристик магазина',
    'store-text': 'размеры извлечены из описания — проверьте',
    unknown: null,
  }[reading.source]
}
