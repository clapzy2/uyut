import type { CatalogCategory } from '@uyut/db'

// Доля бюджета всей квартиры на один предмет категории. Цифры стартовые, крутить по живым данным.
export const budgetShares: Record<CatalogCategory, number> = {
  sofa: 0.25,
  bed: 0.2,
  storage: 0.12,
  table: 0.08,
  chair: 0.07,
  rug: 0.05,
  lamp: 0.04,
  decor: 0.03,
}

export type PriceWindow = { minKopecks: number; maxKopecks: number; shareKopecks: number }

/** Окно цены от трети доли до полутора долей. Без бюджета окна нет: ищем по всему каталогу. */
export function priceWindow(
  budgetKopecks: number | null | undefined,
  category: CatalogCategory,
): PriceWindow | null {
  if (!budgetKopecks || budgetKopecks <= 0) {
    return null
  }
  const shareKopecks = Math.round(budgetKopecks * budgetShares[category])
  return {
    shareKopecks,
    minKopecks: Math.round(shareKopecks / 3),
    maxKopecks: Math.round(shareKopecks * 1.5),
  }
}

/** Ниже этого косинуса совпадение называем «похожим по стилю», а не «нашли такой же». */
export const MATCH_CONFIDENCE_THRESHOLD = 0.55

/**
 * Ниже этого не показываем ничего: молчание честнее ерунды.
 *
 * Замер на кухне владельца: предметы, которых в комнате нет вообще, давали близость 0.17–0.46
 * и подбирали коврик в салон Peugeot и корзину для ванной. Настоящие предметы держались выше.
 */
export const MATCH_FLOOR = 0.45
