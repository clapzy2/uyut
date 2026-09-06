import { type CatalogCategory, catalogCategories } from '@uyut/db'

export function isCatalogCategory(value: string): value is CatalogCategory {
  return (catalogCategories as readonly string[]).includes(value)
}

// Порядок важен: «диван-кровать» — диван, «журнальный столик» — стол, «прикроватная тумба» —
// хранение. Первое совпадение выигрывает, поэтому специфичные слова идут раньше общих.
const rules: Array<{ category: CatalogCategory; pattern: RegExp }> = [
  { category: 'sofa', pattern: /диван|софа|кушетк|sofa|couch|settee/i },
  // «прикроватная тумба» — не кровать: слово должно начинаться с «кроват»
  { category: 'bed', pattern: /(?<![а-яё])кроват|матрас|bed\b|mattress/i },
  { category: 'chair', pattern: /кресл|стул|табурет|банкетк|пуф|armchair|chair|stool|ottoman/i },
  {
    category: 'lamp',
    pattern: /светильник|люстр|лампа|торшер|бра\b|подвес|светод|lamp|light|chandelier/i,
  },
  { category: 'rug', pattern: /ков[её]р|ковров|палас|rug|carpet/i },
  {
    category: 'storage',
    pattern:
      /стеллаж|шкаф|комод|тумб|полк|этажерк|витрин|консол|shelf|shelving|cabinet|wardrobe|dresser|drawers|sideboard|console/i,
  },
  { category: 'table', pattern: /стол|table|desk/i },
  {
    category: 'decor',
    pattern:
      /ваз|картин|постер|зеркал|подушк|плед|свеч|растен|кашпо|часы|статуэтк|vase|mirror|poster|cushion|pillow|throw|candle|plant|clock|art/i,
  },
]

/** Категория по любому набору текстов: путь категории фида, название, подкатегория. */
export function categoryFromText(
  ...texts: Array<string | undefined | null>
): CatalogCategory | null {
  const haystack = texts.filter(Boolean).join(' · ')
  if (haystack.trim() === '') {
    return null
  }
  for (const rule of rules) {
    if (rule.pattern.test(haystack)) {
      return rule.category
    }
  }
  return null
}
