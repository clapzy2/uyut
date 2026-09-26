import { findSwatch } from '@uyut/ai'
import type { CatalogVariant, ShoppingVariant } from '@uyut/db'
import { NotFoundError } from '@/lib/projects/access'

/** Стоимость, фото и ссылка берутся из каталога, а не из запроса браузера. */
export function resolveShoppingVariant(
  requested: ShoppingVariant | null | undefined,
  variants: CatalogVariant[] | null,
): ShoppingVariant | null {
  if (!requested || Object.keys(requested).length === 0) {
    return null
  }
  if (requested.swatchId) {
    const swatch = findSwatch(requested.swatchId)
    if (!swatch) {
      throw new NotFoundError('Материал не найден. Выберите его заново.')
    }
    // Перекраска концепта — пожелание, а не подтверждённая комплектация магазина.
    return { swatchId: swatch.id, color: swatch.ru.toLowerCase() }
  }
  const matches = (variants ?? []).filter(
    (variant) =>
      (variant.color ?? null) === (requested.color ?? null) &&
      (variant.affiliateUrl ?? null) === (requested.affiliateUrl ?? null),
  )
  if (matches.length !== 1) {
    throw new NotFoundError('Вариант товара изменился. Откройте карточку и выберите его заново.')
  }
  return { ...matches[0] }
}
