import type { CatalogCategory } from '@uyut/db'

// Подписи категорий для интерфейса. Живут здесь, а не в пакете каталога, потому что
// клиентским компонентам нельзя тянуть серверный пакет с базой.
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
