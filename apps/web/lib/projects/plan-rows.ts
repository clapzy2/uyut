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
  hasMeasurements: boolean
}

const supported = new Set<RoomKind>(mvpRoomKinds)

/**
 * Прочитанное к правке. Ванные и детские приходят снятыми: их сервис пока не делает,
 * и молча выкинуть такую строку хуже, чем показать с объяснением — иначе человек решит,
 * что мы не увидели половину плана.
 *
 * Комнаты из онбординга план не задваивает, а дополняет: «Гостиная» из анкеты и «Гостиная»
 * с чертежа — одна и та же комната. Пара ищется по типу и только среди комнат без размеров:
 * у промеренной рулеткой комнаты числа свои, и перетирать их прочитанным нельзя.
 */
export function planRows(reading: PlanReading, existing: readonly ExistingRoom[] = []): PlanRow[] {
  const free = existing.filter((room) => !room.hasMeasurements)
  const taken = new Set<string>()
  return reading.rooms.map((room) => {
    const unsupported = !supported.has(room.kind)
    const match = unsupported
      ? undefined
      : free.find((candidate) => candidate.kind === room.kind && !taken.has(candidate.id))
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
      wish: '',
      suspicious: room.suspicious === true,
      ...(room.rechecked && room.rechecked.length > 0
        ? { rechecked: room.rechecked.length > 1 ? ('both' as const) : room.rechecked[0] }
        : {}),
      unsupported,
      ...(match ? { roomId: match.id, roomName: match.name } : {}),
    }
  })
}
