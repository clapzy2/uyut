// Каталог стилей: одна и та же двадцатка используется в библиотеке онбординга, в промптах
// и в запасном эмбеддере. Русские подписи видит пользователь, английские идут в модель.

export const styleFamilies = ['scandi', 'modern', 'loft', 'classic'] as const
export type StyleFamily = (typeof styleFamilies)[number]

export const styleFamilyLabels: Record<StyleFamily, string> = {
  scandi: 'Сканди',
  modern: 'Современный',
  loft: 'Лофт',
  classic: 'Классика',
}

export type StyleEntry = {
  id: string
  family: StyleFamily
  ru: string
  /** Чем отделана комната: стены, пол, потолок. Идёт в промпт как есть. */
  finish: string
  /** Мебель и настроение. Идёт в промпт как есть. */
  descriptor: string
}

export const styleLibrary: readonly StyleEntry[] = [
  {
    id: '01-scandi-light',
    family: 'scandi',
    ru: 'Сканди светлый',
    finish: 'white painted walls, pale oak plank floor, matte white ceiling',
    descriptor:
      'a light grey linen sofa, a slim wooden coffee table, one abstract poster, almost no decor, calm and airy',
  },
  {
    id: '02-scandi-warm',
    family: 'scandi',
    ru: 'Сканди тёплый',
    finish: 'warm beige walls, honey oak floor, matte white ceiling',
    descriptor:
      'an oatmeal linen sofa with wool throws, a rattan basket, dried grasses in a ceramic vase, soft warm light',
  },
  {
    id: '03-scandi-japandi',
    family: 'scandi',
    ru: 'Джапанди',
    finish: 'off-white plaster walls, dark oak floor, matte white ceiling',
    descriptor:
      'low dark walnut furniture, a paper lantern, a tatami-toned rug, one bonsai, restrained and quiet',
  },
  {
    id: '04-scandi-hygge',
    family: 'scandi',
    ru: 'Хюгге',
    finish: 'soft cream walls, warm oak floor, matte white ceiling',
    descriptor:
      'a deep sofa with layered wool blankets and cushions, candles on a wooden stool, warm table lamps, a sheepskin on the floor',
  },
  {
    id: '05-scandi-boho',
    family: 'scandi',
    ru: 'Сканди-бохо',
    finish: 'white walls, light oak floor, matte white ceiling',
    descriptor:
      'a rattan armchair, a macrame wall hanging, many green plants, woven baskets, a striped cotton rug',
  },
  {
    id: '06-modern-minimal',
    family: 'modern',
    ru: 'Минимализм',
    finish: 'soft white walls, pale seamless floor, matte white ceiling',
    descriptor:
      'a low straight sofa, handleless built-in storage, one large artwork, a sculptural floor lamp, nothing extra',
  },
  {
    id: '07-modern-neutral',
    family: 'modern',
    ru: 'Тёплый нейтральный',
    finish: 'cream plaster walls, warm oak floor, matte white ceiling',
    descriptor:
      'a rounded boucle sofa, a travertine coffee table, cappuccino tones, soft curved shapes',
  },
  {
    id: '08-modern-midcentury',
    family: 'modern',
    ru: 'Мид-сенчури',
    finish: 'warm white walls, walnut-toned parquet, matte white ceiling',
    descriptor:
      'a walnut sideboard on tapered legs, a mustard velvet sofa, a terracotta cushion, a globe pendant lamp, a geometric rug',
  },
  {
    id: '09-modern-color',
    family: 'modern',
    ru: 'Контемпорари с цветом',
    finish: 'neutral off-white walls, oak floor, matte white ceiling',
    descriptor:
      'a deep teal sofa, a large colourful abstract painting, a brass floor lamp, a gallery feel',
  },
  {
    id: '10-modern-soft',
    family: 'modern',
    ru: 'Мягкий модерн',
    finish: 'cream matte walls with an arched niche, light oak floor, matte white ceiling',
    descriptor: 'a curved cream sofa, a round rug, a sculptural table lamp, gentle shadows',
  },
  {
    id: '11-loft-industrial',
    family: 'loft',
    ru: 'Индустриальный лофт',
    finish: 'one exposed red brick wall, grey plaster walls, dark concrete-toned floor',
    descriptor:
      'black steel details, a dark leather sofa, an iron shelf, a metal floor lamp, raw and graphic',
  },
  {
    id: '12-loft-soft',
    family: 'loft',
    ru: 'Мягкий лофт',
    finish: 'one brick wall, warm plaster walls, warm oak floor',
    descriptor:
      'a comfortable grey fabric sofa, plenty of textiles and plants, black metal shelving, liveable and warm',
  },
  {
    id: '13-loft-concrete',
    family: 'loft',
    ru: 'Бетон и дерево',
    finish: 'microcement walls with visible texture, wide oak boards, grey ceiling',
    descriptor:
      'a plywood built-in bench, a simple grey sofa, a low solid wood table, one large fig tree, calm brutalist mood',
  },
  {
    id: '14-loft-dark',
    family: 'loft',
    ru: 'Тёмный лофт',
    finish: 'graphite painted walls, dark oak floor, dark ceiling',
    descriptor: 'a cognac leather sofa, black metal frames, focused spot lighting, moody and quiet',
  },
  {
    id: '15-loft-eclectic',
    family: 'loft',
    ru: 'Лофт-эклектика',
    finish: 'part brick, part plaster walls, worn wooden floor',
    descriptor:
      'mismatched vintage furniture, a wall of framed posters, an old wooden chest as a table, a colourful kilim rug',
  },
  {
    id: '16-classic-neoclassic',
    family: 'classic',
    ru: 'Неоклассика светлая',
    finish: 'ivory walls with mouldings and panelling, herringbone parquet, white ceiling cornice',
    descriptor: 'a symmetrical layout, brass details, a pale grey sofa, a marble console',
  },
  {
    id: '17-classic-modern',
    family: 'classic',
    ru: 'Современная классика',
    finish: 'warm grey walls with slim panelling, dark herringbone parquet, white ceiling cornice',
    descriptor:
      'a tufted velvet sofa in deep burgundy, dark wood cabinetry, a marble side table, warm layered lighting',
  },
  {
    id: '18-classic-provence',
    family: 'classic',
    ru: 'Прованс',
    finish: 'pastel sage walls, whitewashed wooden floor, white ceiling',
    descriptor:
      'whitewashed wooden furniture, floral upholstery, lace curtains, a bunch of dried lavender',
  },
  {
    id: '19-classic-english',
    family: 'classic',
    ru: 'Английская классика',
    finish: 'dark green painted walls, dark oak floor, white ceiling cornice',
    descriptor:
      'a wall of bookshelves, a chesterfield sofa, a tartan armchair, table lamps with fabric shades',
  },
  {
    id: '20-classic-artdeco',
    family: 'classic',
    ru: 'Ар-деко',
    finish: 'fluted panelling, emerald and black palette, marble-look floor',
    descriptor:
      'geometric patterns, emerald green velvet, brass and black lacquer, a marble console',
  },
] as const

export const styleIds: readonly string[] = styleLibrary.map((style) => style.id)

export function findStyle(id: string): StyleEntry | undefined {
  return styleLibrary.find((style) => style.id === id)
}

export function stylesByFamily(family: StyleFamily): StyleEntry[] {
  return styleLibrary.filter((style) => style.family === family)
}
