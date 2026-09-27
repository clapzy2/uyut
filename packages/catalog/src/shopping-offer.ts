import type { CatalogVariant, ShoppingVariant } from '@uyut/db'
import { catalogFreshnessNotice } from './freshness'

/** Цена и фото не являются идентификатором ткани: магазин может их обновить. */
export function sameShoppingVariant(
  left: ShoppingVariant | null,
  right: ShoppingVariant | null,
): boolean {
  if (!left || !right) return left === right
  if (left.swatchId || right.swatchId) return left.swatchId === right.swatchId
  return (
    (left.color ?? null) === (right.color ?? null) &&
    (left.affiliateUrl ?? null) === (right.affiliateUrl ?? null)
  )
}

/** Один источник цены для сайта и документа; чтение не меняет сохранённый выбор. */
export function shoppingOffer(
  product: {
    priceKopecks: number
    variants: CatalogVariant[] | null
    lastSyncedAt: Date | null
  },
  selected: ShoppingVariant | null,
): { variant: ShoppingVariant | null; priceKopecks: number; catalogNotice: string | null } {
  let variant = selected
  let variantNotice: string | null = null
  if (selected?.swatchId) {
    // Перекраска — пожелание, не оффер магазина с собственной ценой и ссылкой.
    variant = { swatchId: selected.swatchId, color: selected.color }
  } else if (selected) {
    const matches = (product.variants ?? []).filter((entry) => sameShoppingVariant(entry, selected))
    if (matches.length === 1) {
      variant = matches[0] ?? selected
      if (variant.priceKopecks === undefined) {
        variantNotice =
          'Для выбранного варианта нет отдельной цены. В расчёте — базовая цена товара; цену варианта уточните в магазине'
      } else if (
        (variant.priceKopecks ?? product.priceKopecks) !==
        (selected.priceKopecks ?? product.priceKopecks)
      ) {
        variantNotice = 'Цена выбранного варианта обновлена по каталогу — проверьте перед покупкой'
      }
    } else {
      variantNotice =
        selected.priceKopecks !== undefined
          ? 'Выбранный вариант не подтверждён текущим каталогом. В расчёте — последняя сохранённая цена; цену и наличие уточните в магазине'
          : 'Выбранный вариант не подтверждён текущим каталогом. В расчёте — базовая цена товара; цену варианта и наличие уточните в магазине'
    }
  }
  const notices = [variantNotice, catalogFreshnessNotice(product.lastSyncedAt)].filter(Boolean)
  return {
    variant,
    priceKopecks: variant?.priceKopecks ?? product.priceKopecks,
    catalogNotice: notices.length ? notices.join('. ') : null,
  }
}
