import type { RoomCondition, RoomKind } from '@uyut/db'

export const roomKindLabels: Record<RoomKind, string> = {
  living: 'Гостиная',
  bedroom: 'Спальня',
  kitchen: 'Кухня',
  bath: 'Ванная',
  kid: 'Детская',
}

export const roomConditionLabels: Record<RoomCondition, string> = {
  bare: 'Без отделки',
  finished: 'Ремонт есть, хочу другой интерьер',
  keep: 'Оставить как есть',
}

/** Короткая форма для перечислений и для анкеты помощника */
export const roomConditionShort: Record<RoomCondition, string> = {
  bare: 'без отделки',
  finished: 'с ремонтом, нужен новый интерьер',
  keep: 'с ремонтом, оставляем как есть',
}

/**
 * Подпись под выбором: человек должен понимать, что именно случится с его комнатой.
 *
 * У среднего варианта раньше стояло «стены и окна сохраним, отделку нарисуем заново» — два
 * взаимно исключающих обещания в одной фразе. Сохраняется форма комнаты и проёмы, а не покрытия.
 */
export const roomConditionHints: Record<RoomCondition, string> = {
  bare: 'Комната без ремонта: голые стены, бетонный потолок. Нарисуем и отделку, и обстановку.',
  finished:
    'Сохраним форму комнаты, окна, двери и технику вроде телевизора и батарей. Отделку и мебель нарисуем заново.',
  keep: 'Комната останется как на фото. Поменяем только то, о чём вы попросите в заметках. Без заметки менять нечего, и генерация не запустится.',
}

// Значения повторены здесь, а не взяты из @uyut/db: там это значение, а не тип, и импорт
// из клиентского кода тянет в браузерную сборку драйвер базы. satisfies следит, чтобы списки не разъехались.
export const roomConditionOptions = [
  'bare',
  'finished',
  'keep',
] as const satisfies readonly RoomCondition[]

// В MVP три типа комнат; ванная и детская появятся позже
export const mvpRoomKinds = ['living', 'bedroom', 'kitchen'] as const satisfies readonly RoomKind[]

const areaFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
const dateWithYearFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function formatArea(m2: number | null | undefined): string | null {
  if (m2 === null || m2 === undefined) {
    return null
  }
  return `${areaFormat.format(m2)} м²`
}

export function pluralConcepts(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} концепт`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} концепта`
  }
  return `${count} концептов`
}

export function pluralRooms(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} комната`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} комнаты`
  }
  return `${count} комнат`
}

export function formatDate(date: Date, now = new Date()): string {
  return date.getFullYear() === now.getFullYear()
    ? dateFormat.format(date)
    : dateWithYearFormat.format(date)
}

export function projectMeta(input: {
  houseSeries: string | null
  totalAreaM2: number | null
  roomCount: number
  updatedAt?: Date
}): string {
  const parts = [
    input.houseSeries,
    formatArea(input.totalAreaM2),
    pluralRooms(input.roomCount),
    input.updatedAt ? formatDate(input.updatedAt) : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join(' · ')
}

export function fileNameFromKey(key: string): string {
  return key.split('/').pop() ?? key
}
