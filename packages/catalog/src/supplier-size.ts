import type { CatalogAttributes, CatalogSource } from '@uyut/db'
import type { DimensionsCm } from './dimensions'
import dresserSpecs from './gdeslon-dresser-specs.json'
import { gdeslonLampSpec } from './gdeslon-lamp-specs'

export type SizeProduct = {
  attributes: CatalogAttributes | null
  source?: CatalogSource
  externalId?: string
  title?: string
}

type SupplierSpec = {
  sourceUrl: string
  dimensionsCm: DimensionsCm
  baseCm?: { diameter: number } | { width: number; depth: number }
}

// Проверенные 22.11.2026 карточки относятся к конкретному SKU и варианту.
// Новое название или изменившийся подписанный габарит требуют новой сверки.
export function supplierSize(product: SizeProduct): SupplierSpec | undefined {
  if (product.source !== 'gdeslon' || !product.externalId || !product.title) return
  const spec =
    gdeslonLampSpec(product.externalId, product.title) ??
    dresserSpecs.find((row) => row.externalId === product.externalId && row.title === product.title)
  if (!spec) return
  for (const axis of ['width', 'depth', 'height'] as const) {
    const current = product.attributes?.dimensionsCm?.[axis]
    const verified = spec.dimensionsCm[axis]
    if (
      product.attributes?.dimensionsSource?.[axis] === 'store-parameters' &&
      current !== undefined &&
      verified !== undefined &&
      current !== verified
    )
      return
  }
  return spec
}
