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
  suspicious: boolean
  /** Комнаты этого типа сервис пока не делает, и создать её нельзя */
  unsupported: boolean
}

const supported = new Set<RoomKind>(mvpRoomKinds)

/**
 * Прочитанное к правке. Ванные и детские приходят снятыми: их сервис пока не делает,
 * и молча выкинуть такую строку хуже, чем показать с объяснением — иначе человек решит,
 * что мы не увидели половину плана.
 */
export function planRows(reading: PlanReading): PlanRow[] {
  return reading.rooms.map((room) => {
    const unsupported = !supported.has(room.kind)
    return {
      include: !unsupported,
      name: room.name,
      kind: unsupported ? 'living' : room.kind,
      width: room.widthCm ? String(room.widthCm) : '',
      depth: room.depthCm ? String(room.depthCm) : '',
      // В полях площади человек пишет через запятую, и прочитанное должно выглядеть так же
      area: room.areaM2 ? String(room.areaM2).replace('.', ',') : '',
      suspicious: room.suspicious === true,
      unsupported,
    }
  })
}
