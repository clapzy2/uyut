import type { StyleEntry, StyleFamily } from './styles'

/** Всё, что известно о комнате и о людях к моменту генерации. */
export type ConceptBrief = {
  roomKind: 'living' | 'bedroom' | 'kitchen' | 'bath' | 'kid'
  roomName: string
  areaM2: number | null
  /** bare — ремонта нет, finished — ремонт есть и нужен новый вид, keep — оставляем как есть */
  condition: 'bare' | 'finished' | 'keep'
  /** Заметки пользователя, обычно по-русски */
  notes: string | null
  /** Правка из чата после первой генерации, по-английски: «darker walls, no rug» */
  revision?: string | null
  hasPhoto: boolean
  budgetKopecks: number | null
  household: {
    adults?: number
    kids?: number
    pets?: boolean
    cookHome?: boolean
    receiveGuests?: boolean
    wfh?: boolean
  } | null
  /** Ведущий стиль и ближайшие к нему, посчитанные по лайкам */
  primaryStyle: StyleEntry
  secondaryStyles: StyleEntry[]
  families: StyleFamily[]
}

/** Готовый план генерации: общая часть и по одной вариации на каждый рендер. */
export type PromptPlan = {
  shared: string
  variations: string[]
  /**
   * Требование человека, дописываемое последней фразой каждого задания.
   *
   * Стоит после вариации намеренно: вариация предлагает расстановку, а это — прямая просьба,
   * и в споре побеждать должна она. Раньше просьба стояла в середине задания и проигрывала:
   * «перемести шкаф под окно» превращалось в стол и барную стойку.
   */
  mandate: string
  /** Кто составил план: claude или шаблон */
  source: 'claude' | 'template'
}

export type PromptBuilder = {
  build(brief: ConceptBrief, count: number): Promise<PromptPlan>
}

export type RenderRequest = {
  prompt: string
  /** Фото комнаты как data URI или https-ссылка. Без него рисуем с нуля. */
  imageUrl?: string
  seed?: number
  aspectRatio?: string
}

export type RenderResult = {
  /** Готовая картинка в JPEG или PNG */
  body: Buffer
  contentType: string
  model: string
  seed: number | null
}

export type ConceptRenderer = {
  readonly model: string
  render(request: RenderRequest): Promise<RenderResult>
}

export type EmbedInput = { text?: string; image?: { body: Buffer; contentType: string } }

export type Embedder = {
  readonly name: string
  readonly dimensions: number
  embed(inputs: EmbedInput[]): Promise<number[][]>
}
