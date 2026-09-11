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
    pattern:
      /светильник|люстр|лампа|торшер|(?<![а-яё])бра(?![а-яё])|(?<![а-яё])подвес(?![а-яё])|светод|lamp|light|chandelier/i,
  },
  { category: 'rug', pattern: /ков[её]р|ковров|палас|rug|carpet/i },
  // Стол раньше хранения: «стол письменный с тумбой» — стол, а не тумба.
  // «Прикроватная тумба» слова «стол» не содержит и остаётся хранением.
  //
  // Правило узкое, потому что сюда приходит и путь категории фида: «Мебель / Столовая / Шкафы»
  // не должно стать столом. Отсекаются «столешница», «столовая», «столовые приборы», «Столбург»,
  // «настольная» (по левой границе) и английское «portable». Границы слова заданы явно:
  // в JS \b видит только латиницу и после кириллицы не срабатывает никогда.
  { category: 'table', pattern: /(?<![а-яё])стол(?!ешн|ов|б)|(?<![a-z])table|(?<![a-z])desk/i },
  {
    category: 'storage',
    pattern:
      /стеллаж|шкаф|комод|тумб|полк|этажерк|витрин|консол|shelf|shelving|cabinet|wardrobe|dresser|drawers|sideboard|console/i,
  },
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
