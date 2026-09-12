import type { PlanReading, RoomKind } from '@uyut/db'
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
  /** Комнаты этого типа сервис пока не делает, и создать её нельзя */
  unsupported: boolean
  /** Почему нельзя: такой тип комнаты или такое назначение помещения */
  unsupportedReason?: 'kind' | 'utility'
  /** Комната проекта, которой достанутся эти числа вместо создания новой */
  roomId?: string
  /** Как она называется сейчас: человек должен понять, куда попадут размеры */
  roomName?: string
}

/** Комната проекта глазами этого экрана: что уже есть и чего у неё не хватает */
export type ExistingRoom = {
  id: string
  name: string
  kind: RoomKind
  /** Что человек уже написал про эту комнату: поле желания открывается с этим текстом */
  notes: string | null
}

/**
 * Название для сравнения. Регистр, лишние пробелы и порядковый номер значения не имеют:
 * «Спальня 1» из серии дома и «Спальня» с чертежа — одна и та же комната, а разводит их
 * порядок, в котором они идут.
 */
function sameName(one: string, other: string): boolean {
  const plain = (value: string) =>
    value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/ \d+$/, '').trim()
  return plain(one) === plain(other)
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
  return reading.rooms.map((room) => {
    const unsupported = room.utility === true || !supported.has(room.kind)
    const match = unsupported
      ? undefined
      : existing.find(
          (candidate) =>
            candidate.kind === room.kind &&
            sameName(candidate.name, room.name) &&
            !taken.has(candidate.id),
        )
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
      unsupported,
      ...(match ? { roomId: match.id, roomName: match.name } : {}),
    }
  })
}
