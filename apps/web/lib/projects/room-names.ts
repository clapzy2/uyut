import type { RoomKind } from '@uyut/db'
import { roomKindLabels } from './format'

// Тип комнаты и её название нужны для разного: тип читает генерация и подбор мебели,
// название человек читает в документе и в списке покупок. Чтобы не заставлять писать
// одно и то же дважды, название подставляется от типа, пока его не переписали руками.

const autoName = new RegExp(`^(${Object.values(roomKindLabels).join('|')})( \\d+)?$`)

/** Название считаем своим, как только оно перестало быть подставленным нами */
export function isAutoRoomName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed === '' || autoName.test(trimmed)
}

/**
 * Переименовывает подставленные названия по типам с нумерацией: две спальни это «Спальня»
 * и «Спальня 2». Считаем только подставленные — «Кабинет» на месте спальни в счёт не идёт.
 * Неизменившиеся комнаты возвращаются теми же объектами, чтобы не дёргать лишний рендер.
 */
export function autoRoomNames<Room extends { kind: RoomKind; name: string }>(
  rooms: readonly Room[],
): Room[] {
  const counts = new Map<RoomKind, number>()
  return rooms.map((room) => {
    if (!isAutoRoomName(room.name)) {
      return room
    }
    const order = (counts.get(room.kind) ?? 0) + 1
    counts.set(room.kind, order)
    const label = roomKindLabels[room.kind]
    const name = order === 1 ? label : `${label} ${order}`
    return room.name === name ? room : { ...room, name }
  })
}
