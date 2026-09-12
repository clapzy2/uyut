import type { RoomWithConcepts } from '@/lib/projects/repository'

/**
 * Квартира целиком: какие комнаты можно обставить одним нажатием и почему остальные нельзя.
 *
 * Считается отдельно от действия, потому что то же самое нужно показать человеку до запуска.
 * Он должен видеть список комнат и число рендеров раньше, чем платит за них.
 */

/** Рендеров на комнату при генерации всей квартиры */
export const APARTMENT_COUNT = 3

export type ApartmentRoom = {
  id: string
  name: string
  /** Почему комната не пойдёт в общий запуск */
  skip?: 'busy' | 'done' | 'needsNote'
}

export function apartmentPlan(rooms: readonly RoomWithConcepts[]): {
  rooms: ApartmentRoom[]
  ready: ApartmentRoom[]
  renders: number
} {
  const list = rooms.map((room): ApartmentRoom => {
    if (room.generationRunId) {
      return { id: room.id, name: room.name, skip: 'busy' }
    }
    if (room.conceptCount > 0) {
      return { id: room.id, name: room.name, skip: 'done' }
    }
    // «Оставить как есть» без заметки — пустой запуск: менять в комнате нечего
    if (room.condition === 'keep' && !room.notes?.trim()) {
      return { id: room.id, name: room.name, skip: 'needsNote' }
    }
    return { id: room.id, name: room.name }
  })
  const ready = list.filter((room) => !room.skip)
  return { rooms: list, ready, renders: ready.length * APARTMENT_COUNT }
}

export const skipReasons: Record<NonNullable<ApartmentRoom['skip']>, string> = {
  busy: 'уже генерируется',
  done: 'концепты уже есть',
  needsNote: 'нужна заметка, что поменять',
}
