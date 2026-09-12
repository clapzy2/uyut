import type { CatalogCategory } from '@uyut/db'

/**
 * Вид предмета внутри категории.
 *
 * Категория «стол» в каталоге собрала обеденные, журнальные и письменные столы вместе, и
 * подбор искал по всем сразу. Замер на боевых данных: когда на рендере обеденный стол,
 * победителем по всей категории восемь раз из пятнадцати оказывался письменный стол.
 * Детектор при этом с самого начала знает, что нашёл именно обеденный, — мы просто
 * выбрасывали это знание.
 */
export type CatalogSubcategory =
  | 'dining'
  | 'coffee'
  | 'desk'
  | 'bedside'
  | 'armchair'
  | 'chair'
  | 'stool'
  | 'wardrobe'
  | 'dresser'
  | 'shelving'
  | 'cabinet'
  | 'pendant'
  | 'floorLamp'
  | 'tableLamp'
  | 'wallLamp'
  | 'picture'
  | 'mirror'
  | 'plant'
  | 'vase'

type Rule = { subcategory: CatalogSubcategory; pattern: RegExp }

/**
 * Правила по категориям, в порядке проверки. Первое совпадение выигрывает, поэтому
 * более узкое стоит раньше общего: «стол компьютерный» это письменный, а не обеденный.
 */
const RULES: Partial<Record<CatalogCategory, Rule[]>> = {
  table: [
    { subcategory: 'bedside', pattern: /прикроватн|тумб[аы]? прикроват/i },
    {
      subcategory: 'desk',
      pattern: /письменн|письмен|компьютерн|офисн|для ноутбук|игровой стол|рабочий стол|учениче/i,
    },
    { subcategory: 'coffee', pattern: /журнальн|кофейн|сервировочн|(?<![а-яё])столик(?![а-яё])/i },
    { subcategory: 'dining', pattern: /обеден|кухонн|раскладн|раздвижн|стол-книжк|стол - книжк/i },
  ],
  chair: [
    { subcategory: 'stool', pattern: /барн|табурет|пуф|банкетк/i },
    { subcategory: 'armchair', pattern: /кресл/i },
    { subcategory: 'chair', pattern: /стул|обеденн/i },
  ],
  storage: [
    { subcategory: 'bedside', pattern: /прикроватн/i },
    { subcategory: 'wardrobe', pattern: /шкаф|гардероб|пенал/i },
    { subcategory: 'dresser', pattern: /комод/i },
    { subcategory: 'shelving', pattern: /стеллаж|этажерк|полк|книжн/i },
    { subcategory: 'cabinet', pattern: /тумб|под тв|под телевизор|буфет|витрин/i },
  ],
  lamp: [
    { subcategory: 'wallLamp', pattern: /(?<![а-яё])бра(?![а-яё])|настенн/i },
    { subcategory: 'floorLamp', pattern: /торшер|напольн/i },
    { subcategory: 'tableLamp', pattern: /настольн|прикроватн|ночник/i },
    { subcategory: 'pendant', pattern: /люстр|подвесн|потолочн|(?<![а-яё])подвес(?![а-яё])/i },
  ],
  decor: [
    { subcategory: 'mirror', pattern: /зеркал/i },
    { subcategory: 'picture', pattern: /картин|постер|панно|фоторам|репродукц/i },
    { subcategory: 'plant', pattern: /растени|кашпо|цвето|суккулент|пальм/i },
    { subcategory: 'vase', pattern: /ваз[аоы]|подсвечник|статуэтк|фигурк/i },
  ],
}

/** Вид предмета по названию, или undefined, если по названию не видно. */
export function subcategoryFromText(
  category: CatalogCategory,
  ...parts: Array<string | null | undefined>
): CatalogSubcategory | undefined {
  const rules = RULES[category]
  if (!rules) {
    return undefined
  }
  const text = parts.filter(Boolean).join(' ')
  return rules.find((rule) => rule.pattern.test(text))?.subcategory
}

/**
 * Что искал детектор, переведённое в вид каталога.
 *
 * Ключи — те самые подписи из packages/ai/src/detect.ts. Держим их здесь, а не там,
 * потому что слева от стрелки язык модели, а справа язык каталога, и склеивать их
 * нужно ровно в одном месте.
 */
const BY_DETECTOR_LABEL: Record<string, CatalogSubcategory> = {
  'a dining table': 'dining',
  'a coffee table': 'coffee',
  'a bedside table': 'bedside',
  // Фраза детской: без неё письменный стол искался среди всех столов подряд,
  // и вместо стола для уроков предлагался журнальный
  'a desk': 'desk',
  'an armchair': 'armchair',
  'a chair': 'chair',
  'a bar stool': 'stool',
  'a wardrobe': 'wardrobe',
  'a chest of drawers': 'dresser',
  'a shelving unit': 'shelving',
  'a cabinet': 'cabinet',
  'a pendant lamp': 'pendant',
  'a floor lamp': 'floorLamp',
  'a table lamp': 'tableLamp',
  'a framed picture': 'picture',
  'a mirror': 'mirror',
  'a plant': 'plant',
}

export function subcategoryForLabel(label: string): CatalogSubcategory | undefined {
  return BY_DETECTOR_LABEL[label.trim().toLowerCase()]
}
