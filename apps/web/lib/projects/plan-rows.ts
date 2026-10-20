import type { PlanReading, PlanRoomReading, RoomKind, RoomSpaceKind } from '@uyut/db'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import { mvpRoomKinds } from './format'
import type { NativeRoomScheduleReport } from './plan-native-room-number-links'

/** Строка экрана «мы прочитали так»: то же, что в плане, но в виде, пригодном для полей ввода. */
export type PlanRow = {
  include: boolean
  name: string
  kind: RoomKind
  spaceKind?: RoomSpaceKind
  width: string
  depth: string
  /** A PDF number whose room ownership still needs a person's check. */
  widthCandidate?: string
  depthCandidate?: string
  /** Explicit source-drawing review, never a confirmation of an on-site measurement. */
  widthReviewed?: boolean
  depthReviewed?: boolean
  area: string
  ceiling?: string
  sourceNumber?: number
  /** Чего человек хочет в этой комнате: уходит в заметки комнаты и оттуда в задание модели */
  wish: string
  layoutNotes: string
  /** Сверка описания с этой комнатой, не доказательство точности геометрии. */
  layoutNotesReviewed?: boolean
  suspicious: boolean
  measurementWarnings?: string[]
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

/** An acknowledgment belongs to this exact value and room, not to a later edit. */
export function patchPlanRow(row: PlanRow, patch: Partial<PlanRow>): PlanRow {
  const changedScope = (['name', 'kind', 'spaceKind', 'sourceNumber', 'roomId'] as const).some(
    (key) => Object.hasOwn(patch, key) && patch[key] !== row[key],
  )
  const changedWidth = Object.hasOwn(patch, 'width') && patch.width !== row.width
  const changedDepth = Object.hasOwn(patch, 'depth') && patch.depth !== row.depth
  const changedLayout = Object.hasOwn(patch, 'layoutNotes') && patch.layoutNotes !== row.layoutNotes
  return {
    ...row,
    ...patch,
    ...(changedScope
      ? {
          widthCandidate: undefined,
          depthCandidate: undefined,
          ...(row.widthCandidate === row.width ? { width: '' } : {}),
          ...(row.depthCandidate === row.depth ? { depth: '' } : {}),
        }
      : {}),
    ...(changedScope || changedWidth ? { widthReviewed: false } : {}),
    ...(changedScope || changedDepth ? { depthReviewed: false } : {}),
    ...(changedScope || changedLayout ? { layoutNotesReviewed: false } : {}),
  }
}

/** Explicitly requested omission; existing room measurements are preserved by the repository. */
export function clearUnreviewedPlanAxes(row: PlanRow): PlanRow {
  return patchPlanRow(row, {
    ...(row.widthReviewed ? {} : { width: '' }),
    ...(row.depthReviewed ? {} : { depth: '' }),
  })
}

/** Комната проекта глазами этого экрана: что уже есть и чего у неё не хватает */
export type ExistingRoom = {
  id: string
  name: string
  kind: RoomKind
  /** Что человек уже написал про эту комнату: поле желания открывается с этим текстом */
  notes: string | null
}

/** Add an identified schedule row, never inferred measurements or an automatic project-room match. */
export function appendSourcePlanRow(
  rows: readonly PlanRow[],
  source: { name: string; sourceNumber: number },
  kind: RoomKind | 'utility',
): PlanRow[] | null {
  if (
    rows.length >= 20 ||
    !isPlanRoomSourceNumber(source.sourceNumber) ||
    !source.name.trim() ||
    source.name.trim().length > 40 ||
    rows.some((row) => row.sourceNumber === source.sourceNumber)
  )
    return null
  const utility = kind === 'utility'
  const unsupported = utility || !mvpRoomKinds.some((value) => value === kind)
  const spaceKind = utility
    ? /лоджи/i.test(source.name)
      ? 'loggia'
      : /балкон/i.test(source.name)
        ? 'balcony'
        : undefined
    : undefined
  return [
    ...rows,
    {
      name: source.name.trim(),
      sourceNumber: source.sourceNumber,
      ...(spaceKind ? { spaceKind } : {}),
      kind: utility ? 'living' : kind,
      include: false,
      unsupported,
      ...(unsupported
        ? { unsupportedReason: utility ? ('utility' as const) : ('kind' as const) }
        : {}),
      width: '',
      depth: '',
      area: '',
      ceiling: '',
      wish: '',
      layoutNotes: '',
      suspicious: false,
    },
  ]
}

function outdoorLabel(name: string): { spaceKind: 'balcony' | 'loggia'; key: string } | null {
  const match = /^(балкон|лоджия)(?:\s*[№-]?\s*(\d{1,2}))?$/iu.exec(name.trim())
  if (!match) return null
  const spaceKind = match[1]?.toLowerCase() === 'балкон' ? 'balcony' : 'loggia'
  return { spaceKind, key: `${spaceKind}:${match[2] ? Number(match[2]) : ''}` }
}

/** Pre-fill only explicitly labelled outdoor rows from a checked native table. */
export function appendVerifiedOutdoorScheduleRows(
  rows: PlanRow[],
  schedule: NativeRoomScheduleReport | undefined,
): PlanRow[] {
  if (schedule?.status !== 'draft' || schedule.refusalReason !== null) return rows
  const numbers = schedule.rows.map((row) => row.sourceNumber)
  if (new Set(numbers).size !== numbers.length) return rows

  const outdoor = schedule.rows.flatMap((source) => {
    const label = outdoorLabel(source.name)
    return label ? [{ source, label }] : []
  })
  if (new Set(outdoor.map(({ label }) => label.key)).size !== outdoor.length) return rows
  const unnumberedKinds = new Set(
    rows
      .filter((row) => row.sourceNumber === undefined)
      .map((row) => row.spaceKind ?? outdoorLabel(row.name)?.spaceKind)
      .filter((kind): kind is 'balcony' | 'loggia' => kind === 'balcony' || kind === 'loggia'),
  )
  const missing = outdoor.filter(
    ({ source, label }) =>
      !unnumberedKinds.has(label.spaceKind) &&
      !rows.some(
        (existing) =>
          existing.sourceNumber === source.sourceNumber ||
          outdoorLabel(existing.name)?.key === label.key,
      ),
  )
  if (rows.length + missing.length > 20) return rows

  let next = rows
  for (const { source } of missing) {
    if (
      !Number.isFinite(source.documentaryAreaM2) ||
      source.documentaryAreaM2 <= 0 ||
      source.documentaryAreaM2 > 999.99
    )
      return rows
    const appended = appendSourcePlanRow(next, source, 'utility')
    if (!appended) return rows
    const last = appended.at(-1)
    if (!last) return rows
    next = [
      ...appended.slice(0, -1),
      { ...last, area: String(source.documentaryAreaM2).replace('.', ',') },
    ]
  }
  return next
}

/** A user-observed outdoor zone without a printed label has no inferred area or dimensions. */
export function appendUnlabeledOutdoorPlanRow(
  rows: readonly PlanRow[],
  spaceKind: 'balcony' | 'loggia',
): PlanRow[] | null {
  if (rows.length >= 20) return null
  const baseName = spaceKind === 'balcony' ? 'Балкон' : 'Лоджия'
  let name = baseName
  let number = 2
  while (rows.some((row) => plainName(row.name) === plainName(name))) {
    name = `${baseName} ${number}`
    number += 1
  }
  return [
    ...rows,
    {
      include: false,
      name,
      kind: 'living',
      spaceKind,
      unsupported: true,
      unsupportedReason: 'utility',
      width: '',
      depth: '',
      area: '',
      ceiling: '',
      wish: '',
      layoutNotes: '',
      suspicious: false,
    },
  ]
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
export function planRows(
  reading: PlanReading,
  existing: readonly ExistingRoom[] = [],
  holdPdfDimensions = false,
): PlanRow[] {
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
    const outdoor = room.spaceKind === 'balcony' || room.spaceKind === 'loggia'
    const unsupported = room.utility === true || outdoor || !supported.has(room.kind)
    const paired = unsupported ? { ambiguous: false } : pair(room)
    const match = paired.match
    if (match) {
      taken.add(match.id)
    }
    return {
      include: !unsupported && room.nameOnlyCandidate !== true,
      name: room.name,
      ...(room.spaceKind ? { spaceKind: room.spaceKind } : {}),
      ...(room.sourceNumber === undefined ? {} : { sourceNumber: room.sourceNumber }),
      ceiling: room.ceilingCm === undefined ? '' : String(room.ceilingCm),
      kind: unsupported ? 'living' : room.kind,
      width: !holdPdfDimensions && room.widthCm ? String(room.widthCm) : '',
      depth: !holdPdfDimensions && room.depthCm ? String(room.depthCm) : '',
      ...(holdPdfDimensions && room.widthCm ? { widthCandidate: String(room.widthCm) } : {}),
      ...(holdPdfDimensions && room.depthCm ? { depthCandidate: String(room.depthCm) } : {}),
      // В полях площади человек пишет через запятую, и прочитанное должно выглядеть так же
      area: room.areaM2 ? String(room.areaM2).replace('.', ',') : '',
      wish: match?.notes ?? '',
      layoutNotes: room.layoutNotes ?? '',
      suspicious: room.suspicious === true,
      ...(room.measurementWarnings?.length
        ? { measurementWarnings: room.measurementWarnings }
        : {}),
      ...(unsupported
        ? { unsupportedReason: room.utility || outdoor ? ('utility' as const) : ('kind' as const) }
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
 * Общая площадь на разных листах может включать или исключать балконы и лоджии.
 * Проверяем оба полных состава без выдуманных коэффициентов. Совпадение суммы
 * не подтверждает ни юридический вид площади, ни найденный контур пола.
 *
 * Считается по строкам, а не по чтению: человек правит площади прямо здесь, и сумма должна
 * ходить за его правками. Пять процентов допуска, потому что площади на планах округлены
 * до десятой, а общую нередко меряют по внешнему контуру.
 *
 * Молчим, когда проверять нечем: нет общей площади либо хоть у одной строки нет своей.
 * Неполная сумма всегда меньше общей, и пугать ею не за что.
 */
export function totalAreaCheck(
  rows: ReadonlyArray<Pick<PlanRow, 'area' | 'spaceKind'>>,
  totalM2: number | undefined,
): { sum: string; total: string; agrees: boolean } | null {
  if (totalM2 === undefined || !(totalM2 > 0) || rows.length === 0) {
    return null
  }
  let sum = 0
  let counted = 0
  let outdoorSum = 0
  let outdoorComplete = true
  for (const row of rows) {
    const area = number(row.area)
    if (row.spaceKind === 'balcony' || row.spaceKind === 'loggia') {
      if (area === null) outdoorComplete = false
      else outdoorSum += area
      continue
    }
    if (area === null) {
      return null
    }
    sum += area
    counted += 1
  }
  if (counted === 0 && (!outdoorComplete || outdoorSum === 0)) return null
  const rounded = Math.round((sum + (outdoorComplete ? outdoorSum : 0)) * 100) / 100
  const interior = Math.round(sum * 100) / 100
  return {
    sum: String(rounded).replace('.', ','),
    total: String(totalM2).replace('.', ','),
    agrees:
      Math.abs(rounded - totalM2) / totalM2 <= 0.05 ||
      (counted > 0 && Math.abs(interior - totalM2) / totalM2 <= 0.05),
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
