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
{"ceilingMm": число или null, "totalAreaM2": число или null, "rooms": [{"name": "...", "widthMm": число или null, "depthMm": число или null, "areaM2": число или null, "aspect": число или null}]}

Правила:
- Названия комнат переписывай как есть, по-русски.
- Размеры бери с размерных линий, в миллиметрах. Если на плане сантиметры или метры, переведи в миллиметры.
- widthMm — сторона вдоль горизонтали чертежа, depthMm — вдоль вертикали.
- Размеры часто даны цепочкой отрезков вдоль стены. Ширина комнаты — сумма отрезков её цепочки. Складывай их сам.
- Площадь бери только если она подписана на плане. Не считай её сам.
- aspect — форма комнаты на глаз: во сколько раз она шире, чем глубже. Квадратная — 1, вдвое шире, чем глубже — 2, вдвое глубже, чем шире — 0.5. Отвечай по картинке, а не по размерным линиям, и отвечай всегда.
- totalAreaM2 — общая площадь квартиры, если она подписана на плане. Не складывай её сам.
- Высоту потолка бери из подписи вроде «H = 2700». Если её нет, null.
- Балконы, лоджии, шахты и лестничные клетки в список не включай.
- Ничего не додумывай: чего не видно, то null. Исключение — aspect, его оценивай всегда.`

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
  /**
   * Стороны, посчитанные из площади, а не прочитанные с размерной линии.
   *
   * Замер на трёх настоящих планах: подписанную площадь модель читает верно пять раз из пяти,
   * а сторону складывает из отрезков цепочки и теряет звено. Гостиная 3039 на 1600+528+2516:
   * модель сложила первый и третий отрезки, потеряла средний и выдала 412 см вместо 464.
   * Площадь при этом прочитала верно все пять раз. Поэтому сторона, посчитанная из площади,
   * ближе к правде, чем сложенная, — но человеку это надо сказать вслух.
   */
  estimated?: PlanSide[]
  /** Форма комнаты на глаз: во сколько раз шире, чем глубже. Из неё считаются стороны по площади. */
  aspect?: number
  /** Подсобное помещение: размеры с плана берём, а мебель туда не подбираем */
  utility?: boolean
}

export type PlanReading = {
  ceilingCm?: number
  /** Общая площадь квартиры с плана: по ней проверяется, не потеряна ли комната и не выдумана ли лишняя */
  totalAreaM2?: number
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
 * Границы правдоподобия для формы комнаты. Комнату в пять раз длиннее, чем шире, ещё можно
 * представить — это коридор. Всё, что уже, не форма, а промах модели, и считать по нему стороны нельзя.
 */
const MIN_ASPECT = 0.2
const MAX_ASPECT = 5

/**
 * Насколько сумма площадей комнат может расходиться с общей площадью квартиры.
 *
 * Пять процентов, потому что расходиться она обязана: площади на планах округлены до десятой,
 * а общая нередко считается по внешнему обмеру и включает то, чего в списке комнат нет.
 * Больше пяти — это уже потерянная или выдуманная комната.
 */
const TOTAL_AREA_TOLERANCE = 0.05

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

/**
 * Комнаты, которые не обставляют мебелью из каталога: прихожая, коридор, кладовая.
 * Своего типа у них нет, и без этой пометки они уезжали бы в «гостиную» — сервис рисовал бы
 * диван и ковёр в коридоре шириной метр двадцать.
 */
const UTILITY_WORDS = /прихож|коридор|холл|тамбур|гардероб|кладов|постироч|котельн|лестнич|шахт/i

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
/** Прихожая, коридор и кладовая: размеры у них есть, а обставлять их сервис не берётся. */
export function isUtilityRoom(name: string): boolean {
  return UTILITY_WORDS.test(name)
}

export function roomKindFromName(name: string): RoomKind {
  for (const [pattern, kind] of KIND_WORDS) {
    if (pattern.test(name)) {
      return kind
    }
  }
  return 'living'
}

/** Сантиметры, если это правдоподобная сторона комнаты. */
function boundedCm(centimetres: number): number | undefined {
  const rounded = Math.round(centimetres)
  return rounded >= MIN_SIDE_CM && rounded <= MAX_SIDE_CM ? rounded : undefined
}

function sideCm(millimetres: unknown): number | undefined {
  const value = Number(millimetres)
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return boundedCm(value / 10)
}

function aspectOf(raw: unknown): number | undefined {
  const value = Number(raw)
  return Number.isFinite(value) && value >= MIN_ASPECT && value <= MAX_ASPECT ? value : undefined
}

/** Стороны по площади и форме: ширина и глубина, произведение которых даёт ровно эту площадь. */
function sidesFromArea(
  areaM2: number,
  aspect: number,
): { widthCm: number; depthCm: number } | undefined {
  const areaCm2 = areaM2 * 10_000
  const widthCm = boundedCm(Math.sqrt(areaCm2 * aspect))
  const depthCm = boundedCm(Math.sqrt(areaCm2 / aspect))
  return widthCm === undefined || depthCm === undefined ? undefined : { widthCm, depthCm }
}

/**
 * Достроить недостающие стороны по площади.
 *
 * Одна сторона и площадь дают вторую точно, делением. Не прочитано ни одной — стороны
 * восстанавливаются из площади и формы, и это уже прикидка, но прикидка лучше пустоты:
 * без двух чисел не появится ни вид сверху, ни проверка на влезание.
 */
function settleSides(room: PlanRoom): PlanRoom {
  const { widthCm, depthCm, areaM2, aspect } = room
  if (areaM2 === undefined || (widthCm !== undefined && depthCm !== undefined)) {
    return room
  }
  const areaCm2 = areaM2 * 10_000
  if (widthCm !== undefined) {
    const found = boundedCm(areaCm2 / widthCm)
    return found === undefined ? room : { ...room, depthCm: found, estimated: ['depth'] }
  }
  if (depthCm !== undefined) {
    const found = boundedCm(areaCm2 / depthCm)
    return found === undefined ? room : { ...room, widthCm: found, estimated: ['width'] }
  }
  if (aspect === undefined) {
    return room
  }
  const sides = sidesFromArea(areaM2, aspect)
  return sides === undefined ? room : { ...room, ...sides, estimated: ['width', 'depth'] }
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
  let parsed: { ceilingMm?: unknown; totalAreaM2?: unknown; rooms?: unknown }
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
    const aspect = aspectOf(source.aspect)
    const asRead = {
      name,
      kind: roomKindFromName(name),
      ...(isUtilityRoom(name) ? { utility: true } : {}),
      ...(aspect === undefined ? {} : { aspect }),
      widthCm: sideCm(source.widthMm),
      depthCm: sideCm(source.depthMm),
      areaM2: areaM2(source.areaM2),
    }
    if (
      asRead.widthCm === undefined &&
      asRead.depthCm === undefined &&
      asRead.areaM2 === undefined
    ) {
      continue
    }
    const room = settleSides(asRead)
    rooms.push(looksWrong(room) ? { ...room, suspicious: true } : room)
  }
  const ceiling = ceilingCm(parsed.ceilingMm)
  const total = areaM2(parsed.totalAreaM2)
  return {
    ...(ceiling === undefined ? {} : { ceilingCm: ceiling }),
    ...(total === undefined ? {} : { totalAreaM2: total }),
    rooms,
  }
}

/**
 * Сходится ли сумма площадей комнат с общей площадью квартиры.
 *
 * Единственная проверка, которая ловит потерянную и выдуманную комнату: по одной строке
 * этого не видно, а по сумме видно сразу. На обмерном плане без подписей модель сочиняла
 * лишнюю комнату в шести прогонах из семи, и поймать это было нечем.
 *
 * Возвращает undefined, когда проверять нечем: нет общей площади или хоть у одной комнаты
 * нет своей. Неполная сумма всегда меньше общей, и молчать тут честнее, чем пугать.
 */
export function checkTotalArea(
  reading: PlanReading,
): { sumM2: number; totalM2: number; agrees: boolean } | undefined {
  const total = reading.totalAreaM2
  if (total === undefined || total <= 0 || reading.rooms.length === 0) {
    return undefined
  }
  let sum = 0
  for (const room of reading.rooms) {
    if (room.areaM2 === undefined) {
      return undefined
    }
    sum += room.areaM2
  }
  const sumM2 = Math.round(sum * 10) / 10
  return { sumM2, totalM2: total, agrees: Math.abs(sumM2 - total) / total <= TOTAL_AREA_TOLERANCE }
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
 * Последняя попытка, когда и общий проход, и перечёт по отрезкам дали числа, не сходящиеся
 * с подписанной площадью. Тогда цепочке верить нечего, и стороны считаются из площади и формы.
 *
 * Форму берём со слов модели: её она оценивает по картинке, а не складывает, и именно сложение
 * у неё ломается. Своей оценки нет — берём форму из уже прочитанных сторон: даже когда одна
 * из них неверна, их отношение ближе к правде, чем их произведение.
 */
export function estimateSides(room: PlanRoom): PlanRoom | null {
  if (room.areaM2 === undefined || !needsRecheck(room)) {
    return null
  }
  const aspect =
    room.aspect ??
    (room.widthCm !== undefined && room.depthCm !== undefined
      ? aspectOf(room.widthCm / room.depthCm)
      : undefined)
  if (aspect === undefined) {
    return null
  }
  const sides = sidesFromArea(room.areaM2, aspect)
  if (sides === undefined) {
    return null
  }
  const fixed: PlanRoom = { ...room, ...sides, estimated: ['width', 'depth'] }
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
  let totalAreaM2: number | undefined
  for (const reading of readings) {
    ceilingCm ??= reading.ceilingCm
    totalAreaM2 ??= reading.totalAreaM2
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
  return {
    ...(ceilingCm === undefined ? {} : { ceilingCm }),
    ...(totalAreaM2 === undefined ? {} : { totalAreaM2 }),
    rooms,
  }
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
