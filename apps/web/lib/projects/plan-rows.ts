import type { PlanReading, PlanRoomReading, RoomKind } from '@uyut/db'
import { mvpRoomKinds } from './format'

/** Строка экрана «мы прочитали так»: то же, что в плане, но в виде, пригодном для полей ввода. */
export type PlanRow = {
  include: boolean
  name: string
  kind: RoomKind
  width: string
  depth: string
  area: string
  /** Чего человек хочет в этой комнате: уходит в заметки комнаты и оттуда в задание модели */
  wish: string
  suspicious: boolean
  /** Сторона или обе, которые пришлось перечитать отдельным вопросом, чтобы площадь сошлась */
  rechecked?: 'width' | 'depth' | 'both'
  /** Повторное чтение цепочки не подтвердило исходный размер. */
  chainMismatch?: 'width' | 'depth' | 'both'
  /** Сторона или обе, посчитанные из подписанной площади, а не прочитанные с размерной линии */
  estimated?: 'width' | 'depth' | 'both'
  /** Комнаты этого типа сервис пока не делает, и создать её нельзя */
  unsupported: boolean
  /** Почему нельзя: такой тип комнаты или такое назначение помещения */
  unsupportedReason?: 'kind' | 'utility'
  /** Комната проекта, которой достанутся эти числа вместо создания новой */
  roomId?: string
  /** Как она называется сейчас: человек должен понять, куда попадут размеры */
  roomName?: string
  /** Похожих комнат в проекте несколько, и какая из них эта — знает только человек */
  ambiguous?: boolean
}

/** Комната проекта глазами этого экрана: что уже есть и чего у неё не хватает */
export type ExistingRoom = {
  id: string
  name: string
  kind: RoomKind
  /** Что человек уже написал про эту комнату: поле желания открывается с этим текстом */
  notes: string | null
}

/** Название без регистра, лишних пробелов и ё: по нему ищется точное совпадение. */
function plainName(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/** То же самое без порядкового номера в конце: «Спальня 1» и «Спальня» становятся одним. */
function withoutNumber(value: string): string {
  return plainName(value).replace(/ \d+$/, '')
}

const supported = new Set<RoomKind>(mvpRoomKinds)

/**
 * Прочитанное к правке. Ванные и детские приходят снятыми: их сервис пока не делает,
 * и молча выкинуть такую строку хуже, чем показать с объяснением — иначе человек решит,
 * что мы не увидели половину плана.
 *
 * Комнаты из онбординга план не задваивает, а дополняет: «Гостиная» из анкеты и «Гостиная»
 * с чертежа — одна и та же комната. Пара ищется по названию, а не по типу: своего типа
 * у прихожей, коридора и кабинета пока нет, все они живут как гостиная, и по типу «Прихожая»
 * с плана забрала бы себе гостиную из анкеты вместе с её названием и размерами.
 *
 * Ищем среди всех комнат, а не только среди непромеренных: иначе повторное чтение того же плана
 * заводило вторую «Гостиную» рядом с первой. Промеренное рулеткой при этом не теряется —
 * участки стен план не знает и не трогает.
 */
export function planRows(reading: PlanReading, existing: readonly ExistingRoom[] = []): PlanRow[] {
  const taken = new Set<string>()
  // Сначала точные совпадения названий, и только потом — без номера. Иначе «Спальня 2» с плана
  // забирала бы себе «Спальня 1» просто потому, что идёт первой, и мерки мастер-спальни
  // уезжали бы в детскую вместе с её заметкой.
  const pair = (room: PlanRoomReading): { match?: ExistingRoom; ambiguous: boolean } => {
    const exact = existing.find(
      (candidate) =>
        candidate.kind === room.kind &&
        !taken.has(candidate.id) &&
        plainName(candidate.name) === plainName(room.name),
    )
    if (exact) {
      return { match: exact, ambiguous: false }
    }
    const loose = existing.filter(
      (candidate) =>
        candidate.kind === room.kind &&
        !taken.has(candidate.id) &&
        withoutNumber(candidate.name) === withoutNumber(room.name),
    )
    // Кандидатов несколько — значит, номер как раз и различает комнаты, и угадывать нельзя:
    // мерки мастер-спальни, попавшие в детскую, человек заметит нескоро
    return loose.length === 1
      ? { match: loose[0], ambiguous: false }
      : { ambiguous: loose.length > 1 }
  }
  return reading.rooms.map((room) => {
    const unsupported = room.utility === true || !supported.has(room.kind)
    const paired = unsupported ? { ambiguous: false } : pair(room)
    const match = paired.match
    if (match) {
      taken.add(match.id)
    }
    return {
      include: !unsupported,
      name: room.name,
      kind: unsupported ? 'living' : room.kind,
      width: room.widthCm ? String(room.widthCm) : '',
      depth: room.depthCm ? String(room.depthCm) : '',
      // В полях площади человек пишет через запятую, и прочитанное должно выглядеть так же
      area: room.areaM2 ? String(room.areaM2).replace('.', ',') : '',
      wish: match?.notes ?? '',
      suspicious: room.suspicious === true,
      ...(unsupported
        ? { unsupportedReason: room.utility ? ('utility' as const) : ('kind' as const) }
        : {}),
      ...(room.rechecked && room.rechecked.length > 0
        ? { rechecked: room.rechecked.length > 1 ? ('both' as const) : room.rechecked[0] }
        : {}),
      ...(room.chainMismatch && room.chainMismatch.length > 0
        ? {
            chainMismatch:
              room.chainMismatch.length > 1 ? ('both' as const) : room.chainMismatch[0],
          }
        : {}),
      ...(room.estimated && room.estimated.length > 0
        ? { estimated: room.estimated.length > 1 ? ('both' as const) : room.estimated[0] }
        : {}),
      unsupported,
      ...(match ? { roomId: match.id, roomName: match.name } : {}),
      ...(paired.ambiguous ? { ambiguous: true } : {}),
    }
  })
}

const number = (raw: string) => {
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Сумма площадей комнат против общей площади квартиры с плана.
 *
 * Единственная проверка, которая ловит потерянную и выдуманную комнату: по одной строке этого
 * не видно, по сумме видно сразу. На обмерном плане без подписей модель сочиняла лишнее
 * помещение в шести прогонах из семи, и поймать это было нечем.
 *
 * Считается по строкам, а не по чтению: человек правит площади прямо здесь, и сумма должна
 * ходить за его правками. Пять процентов допуска, потому что площади на планах округлены
 * до десятой, а общую нередко меряют по внешнему контуру.
 *
 * Молчим, когда проверять нечем: нет общей площади либо хоть у одной строки нет своей.
 * Неполная сумма всегда меньше общей, и пугать ею не за что.
 */
export function totalAreaCheck(
  rows: ReadonlyArray<Pick<PlanRow, 'area'>>,
  totalM2: number | undefined,
): { sum: string; total: string; agrees: boolean } | null {
  if (totalM2 === undefined || !(totalM2 > 0) || rows.length === 0) {
    return null
  }
  let sum = 0
  for (const row of rows) {
    const area = number(row.area)
    if (area === null) {
      return null
    }
    sum += area
  }
  const rounded = Math.round(sum * 10) / 10
  return {
    sum: rounded.toFixed(1).replace('.', ','),
    total: totalM2.toFixed(1).replace('.', ','),
    agrees: Math.abs(rounded - totalM2) / totalM2 <= 0.05,
  }
}

export type AreaCheck = {
  text: string
  /** Ширина, при которой площадь сойдётся с глубиной */
  widthCm: number
  /** Глубина, при которой площадь сойдётся с шириной */
  depthCm: number
}

/**
 * Расхождение площади с размерами и два числа, которыми его можно закрыть.
 *
 * Подписанная площадь — самое надёжное число на плане: её печатают, а не складывают из отрезков.
 * Поэтому из неё и глубины считается ширина, из неё и ширины — глубина, а человек выбирает,
 * что из двух он видит на чертеже. На замере модель уверенно и повторно читала ширину гостиной
 * как 393 см при верных 383, и расходилось это ровно в площади.
 */
export function areaCheck(row: Pick<PlanRow, 'width' | 'depth' | 'area'>): AreaCheck | null {
  const width = number(row.width)
  const depth = number(row.depth)
  const area = number(row.area)
  if (width === null || depth === null || area === null) {
    return null
  }
  const computed = (width * depth) / 10_000
  if (Math.abs(computed - area) / area < 0.02) {
    return null
  }
  return {
    text: `По сторонам выходит ${computed.toFixed(1).replace('.', ',')} м², а на плане ${row.area} м².`,
    widthCm: Math.round((area * 10_000) / depth),
    depthCm: Math.round((area * 10_000) / width),
  }
}
