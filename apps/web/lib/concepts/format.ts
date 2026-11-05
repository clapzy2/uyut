import { detectedObjectLabel } from '@uyut/ai/object-label'
import type { DimensionsCm, FitVerdict } from '@uyut/catalog'
import type { CatalogCategory } from '@uyut/db'

// Подписи категорий для интерфейса. Живут здесь, а не в пакете каталога, потому что
// клиентским компонентам нельзя тянуть серверный пакет с базой.
/** Название предмета, а если подпись незнакомая — хотя бы категория. */
export function objectLabel(label: string, category: CatalogCategory): string {
  return detectedObjectLabel(label, categoryLabels[category])
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
  bestmebelshop: 'Bestmebelshop',
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

/** Полный след — «120 × 45 × 101 см»; неполные габариты называем по осям. */
export function sizeLabel(dimensions: DimensionsCm | null | undefined): string | null {
  if (!dimensions) {
    return null
  }
  if (!(dimensions.width && dimensions.depth)) {
    const labels = [
      dimensions.width ? `ширина ${dimensions.width} см` : null,
      dimensions.depth ? `глубина ${dimensions.depth} см` : null,
      dimensions.height ? `высота ${dimensions.height} см` : null,
    ].filter(Boolean)
    return labels.length ? labels.join(', ') : null
  }
  const sides = [dimensions.width, dimensions.depth, dimensions.height].filter(
    (side): side is number => typeof side === 'number' && side > 0,
  )
  return sides.length > 0 ? `${sides.join(' × ')} см` : null
}

/**
 * Вердикт по месту, словами.
 *
 * Называем проверенный габарит, а при неизвестных размерах — следующий шаг.
 * Сравнение с участком стены не подменяет 2D-проверку проходов и рабочих зон.
 */
export function fitLabel(fit: FitVerdict, hasGeometryLayout = false): string {
  const label =
    hasGeometryLayout && fit.state === 'unknown' && fit.reason === 'roomDimensions'
      ? '2D-проверка доступна в комнате. Перед покупкой сверьте размеры на месте.'
      : fitSizeLabel(fit)
  if (fit.ceilingGapCm === undefined) return label
  return `${label.replace(/\.$/, '')}. До потолка ${cmLabel(fit.ceilingGapCm)} см. Проверьте высоту для сборки по инструкции товара.`
}

function cmLabel(value: number): string {
  return value > 0 && value < 0.01
    ? 'менее 0,01'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function fitSizeLabel(fit: FitVerdict): string {
  if (fit.state === 'tooTall' && fit.ceilingCm && fit.overCm !== undefined) {
    return `Корпус выше потолка (${cmLabel(fit.ceilingCm)} см) на ${cmLabel(fit.overCm)} см`
  }
  if (fit.state === 'unknown') {
    if (fit.reason === 'itemDimensions') return 'Для проверки уточните полные размеры товара'
    if (fit.reason === 'roomDimensions') return 'Для проверки укажите размеры комнаты'
    if (fit.reason === 'wallMeasurements') return 'Для проверки измерьте свободный участок стены'
    return 'Для проверки подтвердите размеры'
  }
  if (!fit.spot || fit.itemCm === undefined) {
    return 'Для проверки подтвердите размеры'
  }
  if (fit.state === 'tooWide' && fit.overCm !== undefined) {
    return `Не встанет: шире на ${cmLabel(fit.overCm)} см, ${fit.spot.name} ${cmLabel(fit.spot.widthCm)} см`
  }
  if (fit.state === 'tight') {
    return `По длине впритык: ${fit.spot.name} ${cmLabel(fit.spot.widthCm)} см. Уточните монтажный запас.`
  }
  if (fit.state === 'fits')
    return `Помещается по длине: ${fit.spot.name} ${cmLabel(fit.spot.widthCm)} см`
  return 'Для проверки подтвердите размеры'
}
