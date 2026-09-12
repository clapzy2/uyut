import type { RoomKind } from './detect'
import { FalError, falQueue, toDataUri } from './fal-queue'

/**
 * Чтение обмерного плана квартиры.
 *
 * Это единственный способ узнать настоящие размеры комнаты, не заставляя человека ползать
 * с рулеткой. Из площади длину стены не вывести: двенадцать метров — это и 3×4, и 2×6.
 * Рисующая модель сантиметров не знает вовсе, поэтому числа берём с чертежа и держим отдельно
 * от картинки: по ним считается, влезет ли шкаф, и из них вырастет вид сверху.
 *
 * Замер на синтетических планах с заранее известной истиной: 12 из 12 чисел на чистом чертеже
 * и 12 из 12 на трудном — с размерными цепочками вместо готовой ширины, штриховкой стен,
 * ужатом до 900 пикселей и пережатом в JPEG, как будто план переслали в мессенджере.
 * Цепочки модель складывает сама. Сканы настоящих БТИ не проверены, поэтому человеку всё
 * показывается на правку.
 */

export const PLAN_READER_MODEL = 'anthropic/claude-sonnet-4.5'

/**
 * Задание зрячей модели. Просим именно миллиметры: русские планы подписывают в них,
 * и перевод на стороне модели — лишний повод ошибиться на порядок.
 */
export const FLOOR_PLAN_PROMPT = `Ты читаешь план квартиры и достаёшь из него числа.

Отвечай ТОЛЬКО JSON вида:
{"ceilingMm": число или null, "rooms": [{"name": "...", "widthMm": число или null, "depthMm": число или null, "areaM2": число или null}]}

Правила:
- Названия комнат переписывай как есть, по-русски.
- Размеры бери с размерных линий, в миллиметрах. Если на плане сантиметры или метры, переведи в миллиметры.
- widthMm — сторона вдоль горизонтали чертежа, depthMm — вдоль вертикали.
- Размеры часто даны цепочкой отрезков вдоль стены. Ширина комнаты — сумма отрезков её цепочки. Складывай их сам.
- Площадь бери только если она подписана на плане. Не считай её сам.
- Высоту потолка бери из подписи вроде «H = 2700». Если её нет, null.
- Балконы, лоджии, шахты и лестничные клетки в список не включай.
- Ничего не додумывай: чего не видно, то null.`

/** Одна комната с плана, в сантиметрах: в них же меряет всё остальное приложение. */
export type PlanRoom = {
  name: string
  kind: RoomKind
  widthCm?: number
  depthCm?: number
  areaM2?: number
  /**
   * Подписанная площадь не сходится с размерами больше чем на четверть.
   * Значит, одно из трёх чисел прочитано неверно, и строку надо подсветить человеку.
   */
  suspicious?: boolean
}

export type PlanReading = {
  ceilingCm?: number
  rooms: PlanRoom[]
}

/**
 * Границы правдоподобия. Всё за ними — не размер комнаты, а склеенные числа с чертежа
 * или подпись, принятая за размер. Лучше показать пустое поле, чем шкаф шириной в километр.
 */
const MIN_SIDE_CM = 70
const MAX_SIDE_CM = 2000
const MIN_CEILING_CM = 200
const MAX_CEILING_CM = 500
const MAX_AREA_M2 = 200

/** Насколько подписанная площадь может расходиться с произведением сторон */
const AREA_TOLERANCE = 0.25

const KIND_WORDS: ReadonlyArray<[RegExp, RoomKind]> = [
  [/санузел|ванн|туалет|с\/у|душев/i, 'bath'],
  [/детск|ребён|ребен/i, 'kid'],
  [/кухня-гостиная|кухня-столовая/i, 'kitchen'],
  [/кухн/i, 'kitchen'],
  [/спальн/i, 'bedroom'],
  [/гостин|зал|столов|прихож|коридор|холл|кабинет|гардероб/i, 'living'],
]

/**
 * Тип комнаты по названию с плана. Прихожая и кабинет уезжают в «гостиную» намеренно:
 * своих типов у них пока нет, а generic-комната сломала бы и подбор, и промпт.
 */
export function roomKindFromName(name: string): RoomKind {
  for (const [pattern, kind] of KIND_WORDS) {
    if (pattern.test(name)) {
      return kind
    }
  }
  return 'living'
}

function sideCm(millimetres: unknown): number | undefined {
  const value = Number(millimetres)
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }
  const centimetres = Math.round(value / 10)
  return centimetres >= MIN_SIDE_CM && centimetres <= MAX_SIDE_CM ? centimetres : undefined
}

function areaM2(raw: unknown): number | undefined {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AREA_M2) {
    return undefined
  }
  return Math.round(value * 10) / 10
}

function ceilingCm(millimetres: unknown): number | undefined {
  const value = Number(millimetres)
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }
  const centimetres = Math.round(value / 10)
  return centimetres >= MIN_CEILING_CM && centimetres <= MAX_CEILING_CM ? centimetres : undefined
}

/**
 * Сходятся ли три числа между собой. Проверка бесплатная и ловит ровно ту ошибку,
 * которую иначе никто не заметит: размер, прочитанный с чужой размерной линии.
 */
function looksWrong(room: Omit<PlanRoom, 'suspicious'>): boolean {
  if (room.widthCm === undefined || room.depthCm === undefined || room.areaM2 === undefined) {
    return false
  }
  const computed = (room.widthCm * room.depthCm) / 10_000
  return Math.abs(computed - room.areaM2) / room.areaM2 > AREA_TOLERANCE
}

/**
 * Разбор ответа модели. Строки без единого числа выбрасываем: комната, о которой не известно
 * ничего, кроме названия, в списке только мешает — человеку всё равно вводить всё руками.
 */
export function parseFloorPlan(raw: string): PlanReading {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { rooms: [] }
  }
  let parsed: { ceilingMm?: unknown; rooms?: unknown }
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return { rooms: [] }
  }
  const rooms: PlanRoom[] = []
  for (const entry of Array.isArray(parsed.rooms) ? parsed.rooms : []) {
    const source = entry as Record<string, unknown>
    const name = String(source.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (name === '' || name.length > 40) {
      continue
    }
    const room = {
      name,
      kind: roomKindFromName(name),
      widthCm: sideCm(source.widthMm),
      depthCm: sideCm(source.depthMm),
      areaM2: areaM2(source.areaM2),
    }
    if (room.widthCm === undefined && room.depthCm === undefined && room.areaM2 === undefined) {
      continue
    }
    rooms.push(looksWrong(room) ? { ...room, suspicious: true } : room)
  }
  const ceiling = ceilingCm(parsed.ceilingMm)
  return ceiling === undefined ? { rooms } : { ceilingCm: ceiling, rooms }
}

export type PlanReader = (image: { body: Buffer; contentType: string }) => Promise<PlanReading>

export function createFalPlanReader(apiKey: string): PlanReader {
  return async (image) => {
    const result = await falQueue<{ output?: string }>(apiKey, 'fal-ai/any-llm/vision', {
      model: PLAN_READER_MODEL,
      system_prompt: FLOOR_PLAN_PROMPT,
      prompt: 'Прочитай план.',
      image_url: toDataUri(image),
    })
    const output = result.output ?? ''
    if (output.trim() === '') {
      throw new FalError('план не прочитан: пустой ответ')
    }
    return parseFloorPlan(output)
  }
}
