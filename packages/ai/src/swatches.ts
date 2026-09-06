import type { CatalogCategory } from '@uyut/db'

// Библиотека материалов для перекраски. Класс материала решает, к какому предмету свотч
// применим сдвигом цвета: ткань к дивану, дерево к столу. Металл и камень ждут перекраски
// по маске генеративной моделью во второй версии.
export const swatchClasses = ['fabric', 'velvet', 'boucle', 'leather', 'wood', 'hard'] as const
export type SwatchClass = (typeof swatchClasses)[number]

export const swatchClassLabels: Record<SwatchClass, string> = {
  fabric: 'Лён и рогожка',
  velvet: 'Бархат и велюр',
  boucle: 'Букле',
  leather: 'Кожа',
  wood: 'Дерево',
  hard: 'Металл и камень',
}

export type Hsl = { h: number; s: number; l: number }

export type Swatch = {
  id: string
  ru: string
  class: SwatchClass
  hex: string
  hsl: Hsl
}

export function hexToHsl(hex: string): Hsl {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16) / 255
  const g = Number.parseInt(value.slice(2, 4), 16) / 255
  const b = Number.parseInt(value.slice(4, 6), 16) / 255
  return rgbToHsl(r, g, b)
}

/** Все каналы в диапазоне 0..1, тон тоже как доля круга. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) {
    return { h: 0, s: 0, l }
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6
  } else {
    h = ((r - g) / d + 4) / 6
  }
  return { h, s, l }
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    return [l, l, l]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

function swatch(id: string, ru: string, klass: SwatchClass, hex: string): Swatch {
  return { id, ru, class: klass, hex, hsl: hexToHsl(hex) }
}

export const swatches: readonly Swatch[] = [
  swatch('linen-milk', 'Молочный лён', 'fabric', '#efe9dc'),
  swatch('linen-light', 'Светлый лён', 'fabric', '#d9cfbf'),
  swatch('linen-sand', 'Песочный', 'fabric', '#c9a87c'),
  swatch('linen-grey', 'Серый меланж', 'fabric', '#8f8b85'),
  swatch('linen-graphite', 'Графит', 'fabric', '#4a4a4c'),
  swatch('linen-terracotta', 'Терракота', 'fabric', '#b8623f'),
  swatch('linen-olive', 'Оливковый', 'fabric', '#6f7a52'),
  swatch('linen-mustard', 'Горчичный', 'fabric', '#c9a227'),
  swatch('linen-rose', 'Пыльная роза', 'fabric', '#c8998f'),
  swatch('linen-blue', 'Пыльно-голубой', 'fabric', '#8fa5b3'),
  swatch('linen-navy', 'Тёмно-синий', 'fabric', '#2f3f5c'),
  swatch('velvet-emerald', 'Изумрудный бархат', 'velvet', '#1f5d4b'),
  swatch('velvet-forest', 'Тёмно-зелёный бархат', 'velvet', '#2e4a3a'),
  swatch('velvet-burgundy', 'Бордовый бархат', 'velvet', '#6b1f2f'),
  swatch('velvet-plum', 'Сливовый бархат', 'velvet', '#4b2a4a'),
  swatch('boucle-cream', 'Кремовое букле', 'boucle', '#efe6d6'),
  swatch('boucle-grey', 'Серое букле', 'boucle', '#b9b4ab'),
  swatch('leather-beige', 'Светло-бежевая кожа', 'leather', '#c7a98a'),
  swatch('leather-cognac', 'Коньячная кожа', 'leather', '#9a5a2e'),
  swatch('leather-brown', 'Тёмно-коричневая кожа', 'leather', '#4d3222'),
  swatch('leather-black', 'Чёрная кожа', 'leather', '#1e1c1b'),
  swatch('wood-oak-white', 'Дуб белёный', 'wood', '#e2d5bf'),
  swatch('wood-oak', 'Дуб натуральный', 'wood', '#c9a878'),
  swatch('wood-pine', 'Сосна', 'wood', '#d9b581'),
  swatch('wood-ash-grey', 'Ясень серый', 'wood', '#a89f94'),
  swatch('wood-walnut', 'Орех', 'wood', '#6b4a30'),
  swatch('wood-wenge', 'Венге', 'wood', '#3f2a20'),
  swatch('hard-brass', 'Латунь', 'hard', '#b08d57'),
  swatch('hard-black-metal', 'Чёрный металл', 'hard', '#2b2b2b'),
  swatch('hard-marble', 'Белый мрамор', 'hard', '#e9e6e0'),
]

export function findSwatch(id: string): Swatch | undefined {
  return swatches.find((item) => item.id === id)
}

// Из чего обычно сделан предмет категории: эти классы красятся сдвигом цвета
const classesByCategory: Record<CatalogCategory, SwatchClass[]> = {
  sofa: ['fabric', 'velvet', 'boucle', 'leather'],
  chair: ['fabric', 'velvet', 'boucle', 'leather', 'wood'],
  bed: ['fabric', 'velvet', 'boucle', 'leather', 'wood'],
  rug: ['fabric', 'boucle'],
  table: ['wood'],
  storage: ['wood'],
  lamp: ['fabric', 'wood'],
  decor: ['fabric', 'wood'],
}

export type SwatchAvailability = 'ok' | 'v2'

/** Свотч чужого класса не красится сдвигом цвета: показываем приглушённым с пометкой «v2». */
export function swatchAvailability(category: CatalogCategory, item: Swatch): SwatchAvailability {
  return classesByCategory[category].includes(item.class) ? 'ok' : 'v2'
}

/** Сильный сдвиг светлоты делает тени плоскими: честно предупреждаем «приблизительно». */
export const APPROXIMATE_LIGHTNESS_DELTA = 0.35

export function isApproximate(sourceLightness: number, item: Swatch): boolean {
  return Math.abs(item.hsl.l - sourceLightness) > APPROXIMATE_LIGHTNESS_DELTA
}
