import type { DimensionsCm } from '@uyut/catalog'

/**
 * Размеры строки списка: сперва вписанные человеком, потом из карточки магазина.
 *
 * У дивана в фиде габаритов почти никогда нет — из четырёхсот шестидесяти двух они нашлись
 * у одного, — а без них вид сверху молчит про самый крупный предмет комнаты. Поэтому человеку
 * дают вписать их самому, и его число главнее.
 */
export function effectiveSize(
  item: { dimensionsCm: DimensionsCm | null },
  product: { attributes: { dimensionsCm?: DimensionsCm } | null },
): DimensionsCm | null {
  const own = item.dimensionsCm
  if (own && (own.width || own.depth || own.height)) {
    return own
  }
  return product.attributes?.dimensionsCm ?? null
}
