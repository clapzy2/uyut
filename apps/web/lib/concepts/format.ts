import type { DimensionsCm, FitVerdict } from '@uyut/catalog'
import type { CatalogCategory } from '@uyut/db'

// Подписи категорий для интерфейса. Живут здесь, а не в пакете каталога, потому что
// клиентским компонентам нельзя тянуть серверный пакет с базой.
/**
 * Как называть найденный предмет человеку.
 *
 * По категории три разных предмета на одном рендере назывались одинаково: «Хранение», «Хранение»,
 * «Хранение». Детектор при этом знает, что нашёл именно шкаф, стеллаж или тумбу.
 */
const objectLabels: Record<string, string> = {
  'a sofa': 'Диван',
  'an armchair': 'Кресло',
  'a chair': 'Стул',
  'a bar stool': 'Барный стул',
  'a dining table': 'Обеденный стол',
  'a coffee table': 'Журнальный стол',
  'a bedside table': 'Прикроватная тумба',
  'a wardrobe': 'Шкаф',
  'a chest of drawers': 'Комод',
  'a shelving unit': 'Стеллаж',
  'a cabinet': 'Тумба',
  'a bed': 'Кровать',
  'a rug': 'Ковёр',
  'a pendant lamp': 'Подвесной светильник',
  'a floor lamp': 'Торшер',
  'a table lamp': 'Настольная лампа',
  'a framed picture': 'Картина',
  'a mirror': 'Зеркало',
  'a plant': 'Растение',
}

/** Название предмета, а если подпись незнакомая — хотя бы категория. */
export function objectLabel(label: string, category: CatalogCategory): string {
  return objectLabels[label.trim().toLowerCase()] ?? categoryLabels[category]
}

export const categoryLabels: Record<CatalogCategory, string> = {
  sofa: 'Диван',
  chair: 'Кресло',
  table: 'Стол',
  storage: 'Хранение',
  lamp: 'Светильник',
  rug: 'Ковёр',
  bed: 'Кровать',
  decor: 'Декор',
}

export const sourceLabels: Record<string, string> = {
  ozon: 'Ozon',
  wb: 'Wildberries',
  ikea: 'IKEA',
  leroy: 'Леруа Мерлен',
  divan: 'Divan.ru',
  hoff: 'Hoff',
  askona: 'Askona',
  gdeslon: 'Где Слон?',
  dump: 'каталог',
}

export function sourceLabel(source: string): string {
  return sourceLabels[source] ?? source
}

const rubles = new Intl.NumberFormat('ru-RU')

export function formatPrice(kopecks: number): string {
  return `${rubles.format(Math.round(kopecks / 100))} ₽`
}

/** Габариты одной строкой: «120 × 45 × 101 см». Порядок как у магазина, без букв Ш·Г·В. */
export function sizeLabel(dimensions: DimensionsCm | null | undefined): string | null {
  if (!dimensions) {
    return null
  }
  const sides = [dimensions.width, dimensions.depth, dimensions.height].filter(
    (side): side is number => typeof side === 'number' && side > 0,
  )
  return sides.length > 0 ? `${sides.join(' × ')} см` : null
}

/**
 * Вердикт по месту, словами.
 *
 * Молчим, когда мерок нет: пустая строка честнее догадки. «Не встанет» показываем с числом,
 * чтобы человек мог проверить нас сам.
 */
export function fitLabel(fit: FitVerdict): string | null {
  if (fit.state === 'unknown' || !fit.spot || fit.itemCm === undefined) {
    return null
  }
  if (fit.state === 'tooWide') {
    return `Не встанет: шире на ${fit.overCm} см, ${fit.spot.name} ${fit.spot.widthCm} см`
  }
  if (fit.state === 'tight') {
    return `Впритык: ${fit.spot.name} ${fit.spot.widthCm} см`
  }
  return `Встанет: ${fit.spot.name} ${fit.spot.widthCm} см`
}
