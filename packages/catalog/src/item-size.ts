import type { CatalogAttributes } from '@uyut/db'
import type { DimensionsCm } from './dimensions'

type DimensionSource = 'user' | 'store-parameters' | 'store-text'

export type ItemSizeReading = {
  dimensionsCm: DimensionsCm | null
  source: DimensionSource | 'mixed' | 'unknown'
  confidence: 'confirmed' | 'reported' | 'parsed' | 'unknown'
  dimensionSources?: Partial<Record<keyof DimensionsCm, DimensionSource>>
}

/** Пользователь уточняет отдельные мерки; остальные сохраняются из карточки магазина. */
export function effectiveSizeReading(
  item: { dimensionsCm: DimensionsCm | null },
  product: { attributes: CatalogAttributes | null },
): ItemSizeReading {
  const dimensionsCm: DimensionsCm = {}
  const dimensionSources: NonNullable<ItemSizeReading['dimensionSources']> = {}
  for (const axis of ['width', 'depth', 'height'] as const) {
    const own = item.dimensionsCm?.[axis]
    const stored = product.attributes?.dimensionsCm?.[axis]
    if (own !== undefined && Number.isFinite(own) && own > 0) {
      dimensionsCm[axis] = own
      dimensionSources[axis] = 'user'
    } else if (stored !== undefined && Number.isFinite(stored) && stored > 0) {
      dimensionsCm[axis] = stored
      dimensionSources[axis] =
        product.attributes?.dimensionsSource?.[axis] === 'store-parameters'
          ? 'store-parameters'
          : 'store-text'
    }
  }
  const sources = Object.values(dimensionSources)
  if (sources.length === 0) {
    return { dimensionsCm: null, source: 'unknown', confidence: 'unknown' }
  }
  if (sources.every((source) => source === 'user')) {
    return { dimensionsCm, source: 'user', confidence: 'confirmed' }
  }
  const confidence = sources.includes('store-text') ? 'parsed' : 'reported'
  if (sources.includes('user')) {
    return { dimensionsCm, source: 'mixed', confidence, dimensionSources }
  }
  return {
    dimensionsCm,
    source: confidence === 'reported' ? 'store-parameters' : 'store-text',
    confidence,
  }
}

export function effectiveSize(
  item: { dimensionsCm: DimensionsCm | null },
  product: { attributes: CatalogAttributes | null },
): DimensionsCm | null {
  return effectiveSizeReading(item, product).dimensionsCm
}

export function itemSizeSourceLabel(reading: ItemSizeReading): string | null {
  if (reading.source === 'mixed') {
    const names = { width: 'ширина', depth: 'глубина', height: 'высота' }
    return (['user', 'store-parameters', 'store-text'] as const)
      .map((source) => {
        const axes = (['width', 'depth', 'height'] as const)
          .filter((axis) => reading.dimensionSources?.[axis] === source)
          .map((axis) => names[axis])
        if (axes.length === 0) return null
        const labels = {
          user: 'введено вами',
          'store-parameters': 'из характеристик магазина',
          'store-text': 'из описания магазина — проверьте',
        }
        return `${axes.join(', ')} — ${labels[source]}`
      })
      .filter(Boolean)
      .join('; ')
  }
  return {
    user: 'размеры введены вами',
    'store-parameters': 'размеры из характеристик магазина',
    'store-text': 'размеры извлечены из описания — проверьте',
    unknown: null,
  }[reading.source]
}
