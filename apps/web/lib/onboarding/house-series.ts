import type { RoomKind } from '@uyut/db'

// Типовые серии панельных домов. Пользователь редко знает это слово, поэтому в интерфейсе
// путь необязательный и подписан простыми словами. Площади примерные, их можно поправить.

export type SeriesRoom = { kind: RoomKind; name: string; areaM2: number }

export type HouseSeries = {
  id: string
  /** Как серия называется в объявлениях */
  label: string
  /** Одна строка для человека, который слышит это впервые */
  hint: string
  /** Наборы комнат по числу жилых комнат в квартире */
  layouts: Record<1 | 2 | 3, SeriesRoom[]>
}

function layout(kitchen: number, living: number, bedrooms: number[] = []): SeriesRoom[] {
  const rooms: SeriesRoom[] = [
    { kind: 'living', name: 'Гостиная', areaM2: living },
    ...bedrooms.map((areaM2, index) => ({
      kind: 'bedroom' as const,
      name: bedrooms.length > 1 ? `Спальня ${index + 1}` : 'Спальня',
      areaM2,
    })),
    { kind: 'kitchen', name: 'Кухня', areaM2: kitchen },
  ]
  return rooms
}

export const houseSeries: readonly HouseSeries[] = [
  {
    id: 'p-44',
    label: 'П-44 и П-44Т',
    hint: 'Панельные дома 1980-х и 2000-х, самая частая серия в Москве и области',
    layouts: { 1: layout(8.6, 17), 2: layout(8.6, 17, [13]), 3: layout(8.6, 17, [13, 10.5]) },
  },
  {
    id: 'p-3',
    label: 'П-3 и П-3М',
    hint: 'Панельные дома 1970-х и 1990-х, узнаются по эркерам',
    layouts: { 1: layout(8.5, 16.5), 2: layout(8.5, 16.5, [13]), 3: layout(8.5, 16.5, [13, 9]) },
  },
  {
    id: 'i-155',
    label: 'И-155',
    hint: 'Панельные дома 2000-х с просторными кухнями',
    layouts: { 1: layout(11, 18), 2: layout(11, 18, [14]), 3: layout(11, 18, [14, 11]) },
  },
  {
    id: 'kope',
    label: 'КОПЭ',
    hint: 'Панельные башни 1980-х и 2000-х',
    layouts: {
      1: layout(9.5, 17.5),
      2: layout(9.5, 17.5, [13.5]),
      3: layout(9.5, 17.5, [13.5, 11]),
    },
  },
  {
    id: '1-515',
    label: '1-515, «хрущёвка»',
    hint: 'Пятиэтажки 1960-х с маленькой кухней',
    layouts: { 1: layout(5.5, 17), 2: layout(5.5, 17, [10]), 3: layout(5.5, 17, [10, 8]) },
  },
  {
    id: 'monolith',
    label: 'Новостройка, монолит',
    hint: 'Дома 2010-х и новее со свободной планировкой',
    layouts: { 1: layout(12, 20), 2: layout(12, 20, [14]), 3: layout(12, 20, [14, 12]) },
  },
] as const

export const seriesRoomCounts = [1, 2, 3] as const
export type SeriesRoomCount = (typeof seriesRoomCounts)[number]

export function findSeries(id: string): HouseSeries | undefined {
  return houseSeries.find((series) => series.id === id)
}

export function seriesLayout(id: string, count: SeriesRoomCount): SeriesRoom[] {
  return findSeries(id)?.layouts[count] ?? []
}

export function totalAreaOf(rooms: readonly SeriesRoom[]): number {
  // К жилым комнатам добавляем коридор и санузел: примерно четверть от их площади
  const living = rooms.reduce((sum, room) => sum + room.areaM2, 0)
  return Math.round(living * 1.25 * 10) / 10
}
