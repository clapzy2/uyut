import type { CatalogCategory } from '@uyut/db'
import { FalError, falQueue, toDataUri } from './fal-queue'

export type RoomKind = 'living' | 'bedroom' | 'kitchen' | 'bath' | 'kid'

/** Рамка долями от ширины и высоты картинки: 0..1, чтобы не зависеть от размера показа. */
export type NormalizedBox = { x: number; y: number; w: number; h: number }

export type DetectedObject = {
  /** Что искали: «a sofa», «a floor lamp» */
  label: string
  category: CatalogCategory
  bbox: NormalizedBox
  /** Доля площади картинки, для выбора самых крупных предметов */
  area: number
}

export type Detector = {
  detect(
    image: { body: Buffer; contentType: string; width: number; height: number },
    roomKind: RoomKind,
    limit?: number,
  ): Promise<DetectedObject[]>
}

type Phrase = { phrase: string; category: CatalogCategory }

// Florence-2 ищет по фразам из подписи: одна фраза — одна категория каталога. Список зависит от
// типа комнаты, чтобы в спальне не искали диван, а на кухне — кровать.
const phrasesByRoom: Record<RoomKind, Phrase[]> = {
  living: [
    { phrase: 'a sofa', category: 'sofa' },
    { phrase: 'an armchair', category: 'chair' },
    { phrase: 'a coffee table', category: 'table' },
    { phrase: 'a rug', category: 'rug' },
    { phrase: 'a pendant lamp', category: 'lamp' },
    { phrase: 'a floor lamp', category: 'lamp' },
    { phrase: 'a shelving unit', category: 'storage' },
    { phrase: 'a cabinet', category: 'storage' },
    { phrase: 'a framed picture', category: 'decor' },
    { phrase: 'a plant', category: 'decor' },
  ],
  bedroom: [
    { phrase: 'a bed', category: 'bed' },
    { phrase: 'a wardrobe', category: 'storage' },
    { phrase: 'a chest of drawers', category: 'storage' },
    { phrase: 'a bedside table', category: 'table' },
    { phrase: 'an armchair', category: 'chair' },
    { phrase: 'a rug', category: 'rug' },
    { phrase: 'a pendant lamp', category: 'lamp' },
    { phrase: 'a table lamp', category: 'lamp' },
    { phrase: 'a mirror', category: 'decor' },
    { phrase: 'a plant', category: 'decor' },
  ],
  // На кухне ищем только то, что покупают штукой. Гарнитур делают по размеру, и подбирать к нему
  // шкаф из каталога бессмысленно. Ковёр и картина убраны по другой причине: детектор не решает,
  // есть ли предмет, ему говорят «найди ковёр», и он находит плитку пола. На боевой кухне так
  // подбирался коврик в салон Peugeot к ковру, которого там нет.
  kitchen: [
    { phrase: 'a dining table', category: 'table' },
    { phrase: 'a chair', category: 'chair' },
    { phrase: 'a bar stool', category: 'chair' },
    { phrase: 'a pendant lamp', category: 'lamp' },
    { phrase: 'a plant', category: 'decor' },
  ],
  bath: [
    { phrase: 'a cabinet', category: 'storage' },
    { phrase: 'a mirror', category: 'decor' },
    { phrase: 'a pendant lamp', category: 'lamp' },
    { phrase: 'a rug', category: 'rug' },
  ],
  kid: [
    { phrase: 'a bed', category: 'bed' },
    { phrase: 'a desk', category: 'table' },
    { phrase: 'a chair', category: 'chair' },
    { phrase: 'a wardrobe', category: 'storage' },
    { phrase: 'a shelving unit', category: 'storage' },
    { phrase: 'a rug', category: 'rug' },
    { phrase: 'a pendant lamp', category: 'lamp' },
    { phrase: 'a framed picture', category: 'decor' },
  ],
}

export function detectorCaption(roomKind: RoomKind): string {
  const phrases = phrasesByRoom[roomKind].map((item) => item.phrase)
  const last = phrases.pop()
  return `${phrases.join(', ')} and ${last} in a room.`
}

type GroundingResponse = {
  results?: { bboxes?: Array<{ x: number; y: number; w: number; h: number; label?: string }> }
}

function categoryFor(label: string, roomKind: RoomKind): Phrase | undefined {
  const normalized = label.trim().toLowerCase()
  return phrasesByRoom[roomKind].find((item) => item.phrase === normalized)
}

function intersectionOverUnion(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.w * a.h + b.w * b.h - overlap
  return union > 0 ? overlap / union : 0
}

/**
 * Чистка ответа детектора: рамки на всю картинку, крошечные и дубли одной категории убираются,
 * остаются самые крупные предметы. Порядок по площади и есть порядок номеров на рендере.
 */
export function selectObjects(
  raw: Array<{ label: string; category: CatalogCategory; bbox: NormalizedBox }>,
  limit: number,
): DetectedObject[] {
  const candidates = raw
    .map((item) => ({ ...item, area: item.bbox.w * item.bbox.h }))
    .filter((item) => item.area > 0.002 && item.area < 0.85)
    .sort((left, right) => right.area - left.area)
  const kept: DetectedObject[] = []
  for (const candidate of candidates) {
    const duplicate = kept.some(
      (item) =>
        item.category === candidate.category &&
        intersectionOverUnion(item.bbox, candidate.bbox) > 0.5,
    )
    if (!duplicate) {
      kept.push(candidate)
    }
    if (kept.length >= limit) {
      break
    }
  }
  return kept
}

export function createFalDetector(apiKey: string, options: { timeoutMs?: number } = {}): Detector {
  const timeoutMs = options.timeoutMs ?? 90_000
  return {
    async detect(image, roomKind, limit = 6) {
      const response = await falQueue<GroundingResponse>(
        apiKey,
        'fal-ai/florence-2-large/caption-to-phrase-grounding',
        { image_url: toDataUri(image), text_input: detectorCaption(roomKind) },
        timeoutMs,
      )
      const boxes = response.results?.bboxes
      if (!boxes) {
        throw new FalError('детектор вернул ответ без рамок')
      }
      const raw = boxes.flatMap((box) => {
        const phrase = box.label ? categoryFor(box.label, roomKind) : undefined
        if (!phrase) {
          return []
        }
        return [
          {
            label: phrase.phrase,
            category: phrase.category,
            bbox: {
              x: Math.max(0, box.x / image.width),
              y: Math.max(0, box.y / image.height),
              w: Math.min(1, box.w / image.width),
              h: Math.min(1, box.h / image.height),
            },
          },
        ]
      })
      return selectObjects(raw, limit)
    },
  }
}
