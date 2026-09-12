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
  /** Сторону перечитали отдельным вопросом по отрезкам цепочки, и после этого площадь сошлась */
  rechecked?: PlanSide[]
}

export type PlanReading = {
  ceilingCm?: number
  rooms: PlanRoom[]
}

/** Сторона комнаты на чертеже: вдоль горизонтали или вдоль вертикали */
export type PlanSide = 'width' | 'depth'

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

/**
 * Порог, с которого имеет смысл перечитать сторону по отрезкам.
 *
 * Два процента — это уже не округление подписи, а прочитанная не та цифра. Замер на трудном плане:
 * общим проходом модель читала ширину гостиной как 393 см при верных 383 в пяти случаях из шести,
 * и на своей ошибке настаивала даже когда её прямо просили сверяться с площадью. Тот же вопрос,
 * заданный про одну комнату и одну сторону с просьбой перечислить отрезки цепочки, дал 900+2100+830
 * пять раз из пяти. Отсюда и правило: сомнительное место перечитывается отдельным вопросом.
 */
const RECHECK_TOLERANCE = 0.02

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
  // В плане БТИ трёшки все три комнаты подписаны «Комната». Одинаковые названия разводим
  // номерами прямо здесь: дальше по ним ищется пара с уже заведённой комнатой и собирается
  // ответ, и два одинаковых ключа схлопнули бы квартиру до одной комнаты.
  const used = new Map<string, number>()
  for (const entry of Array.isArray(parsed.rooms) ? parsed.rooms : []) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const source = entry as Record<string, unknown>
    const read = String(source.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (read === '' || read.length > 40) {
      continue
    }
    const seen = (used.get(read.toLowerCase()) ?? 0) + 1
    used.set(read.toLowerCase(), seen)
    const name = seen === 1 ? read : `${read} ${seen}`
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

/** Не сходится ли площадь настолько, что стоит перечитать стороны отдельным вопросом. */
export function needsRecheck(room: PlanRoom): boolean {
  if (room.widthCm === undefined || room.depthCm === undefined || room.areaM2 === undefined) {
    return false
  }
  const computed = (room.widthCm * room.depthCm) / 10_000
  return Math.abs(computed - room.areaM2) / room.areaM2 > RECHECK_TOLERANCE
}

/**
 * Задание на перечёт одной стороны одной комнаты.
 *
 * Просим перечислить отрезки, а не назвать сумму: складывает модель хорошо, а вот увидеть
 * «830» там, где она уже решила, что там «930», у неё получается только если заставить
 * выписать числа по одному.
 */
export const SIDE_RECHECK_PROMPT = `Ты читаешь обмерный план и отвечаешь про одну комнату.

Отвечай ТОЛЬКО JSON вида: {"segments": [числа в миллиметрах], "totalMm": число}

Правила:
- segments — отрезки размерной цепочки вдоль запрошенной стороны, по порядку, как подписаны на плане.
- Переписывай каждое число ровно так, как оно напечатано. Не округляй и не додумывай.
- Если сторона подписана одним числом, в segments одно число.
- totalMm — сумма segments.
- Не видишь размерной линии у этой стороны — верни пустой segments и totalMm равным null.`

/** Сумма отрезков в сантиметрах или undefined, если отрезков нет либо сумма неправдоподобна. */
export function parseSideRecheck(raw: string): number | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return undefined
  }
  let parsed: { segments?: unknown }
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return undefined
  }
  const segments = Array.isArray(parsed.segments) ? parsed.segments : []
  if (segments.length === 0) {
    return undefined
  }
  let sum = 0
  for (const segment of segments) {
    const value = Number(segment)
    if (!Number.isFinite(value) || value <= 0) {
      return undefined
    }
    sum += value
  }
  // Считаем сами, а не берём totalMm: сложение — единственное, в чём мы можем не сомневаться
  return sideCm(sum)
}

/**
 * Принять ли перечитанные стороны вместо прочитанных общим проходом.
 *
 * Меняем только тогда, когда после замены подписанная площадь сходится: иначе мы бы молча
 * поменяли одну ошибку на другую, а у человека не осталось бы ни единого признака, что числам
 * нельзя верить. Не сошлась — отдаём исходную строку с пометкой, пусть смотрит сам.
 */
export function applyRecheck(
  room: PlanRoom,
  side: { widthCm?: number; depthCm?: number },
): PlanRoom | null {
  const widthCm = side.widthCm ?? room.widthCm
  const depthCm = side.depthCm ?? room.depthCm
  if (widthCm === undefined || depthCm === undefined || room.areaM2 === undefined) {
    return null
  }
  const off = Math.abs((widthCm * depthCm) / 10_000 - room.areaM2) / room.areaM2
  if (off > RECHECK_TOLERANCE) {
    return null
  }
  const rechecked: PlanSide[] = []
  if (side.widthCm !== undefined && side.widthCm !== room.widthCm) {
    rechecked.push('width')
  }
  if (side.depthCm !== undefined && side.depthCm !== room.depthCm) {
    rechecked.push('depth')
  }
  if (rechecked.length === 0) {
    return null
  }
  const fixed: PlanRoom = { ...room, widthCm, depthCm, rechecked }
  delete fixed.suspicious
  return fixed
}

/**
 * Комнаты со всех страниц файла: одноимённую с первой страницы вторая не перебивает.
 *
 * Повторы внутри одной страницы — не повторы: у трёшки в плане БТИ все комнаты подписаны
 * «Комната», и разводит их номерами разбор ответа. Здесь отсеиваются только те, что уже
 * встретились на предыдущих страницах: у многостраничных планов первый лист часто повторяет
 * часть второго.
 */
export function mergeReadings(readings: readonly PlanReading[]): PlanReading {
  const rooms: PlanRoom[] = []
  const seen = new Set<string>()
  let ceilingCm: number | undefined
  for (const reading of readings) {
    ceilingCm ??= reading.ceilingCm
    const onThisPage: string[] = []
    for (const room of reading.rooms) {
      const key = room.name.trim().toLowerCase()
      if (key === '' || seen.has(key)) {
        continue
      }
      onThisPage.push(key)
      rooms.push(room)
    }
    for (const key of onThisPage) {
      seen.add(key)
    }
  }
  return ceilingCm === undefined ? { rooms } : { ceilingCm, rooms }
}

const SIDE_WORDS: Record<PlanSide, string> = {
  width: 'ширины, то есть по горизонтали чертежа',
  depth: 'глубины, то есть по вертикали чертежа',
}

export type SideReader = (
  image: { body: Buffer; contentType: string },
  roomName: string,
  side: PlanSide,
) => Promise<number | undefined>

export function createFalSideReader(apiKey: string): SideReader {
  return async (image, roomName, side) => {
    const result = await falQueue<{ output?: string }>(apiKey, 'fal-ai/any-llm/vision', {
      model: PLAN_READER_MODEL,
      system_prompt: SIDE_RECHECK_PROMPT,
      prompt: `Комната «${roomName}». Нужна размерная цепочка вдоль её ${SIDE_WORDS[side]}. Перечисли отрезки.`,
      image_url: toDataUri(image),
    })
    return parseSideRecheck(result.output ?? '')
  }
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
