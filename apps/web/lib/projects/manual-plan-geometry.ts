import type { PlanGeometry, PlanRoomShape } from '@uyut/db'

type NamedRoom = { name: string; sourceNumber?: number }

/** A shared physical zone covers its schedule rows once, without a fictitious divider. */
export function manualRoomCoverage(
  shapes: readonly PlanRoomShape[],
  readings: readonly NamedRoom[],
): { valid: boolean; missing: string[] } {
  const covered = new Set<NamedRoom>()
  for (const shape of shapes) {
    const numbers =
      shape.sourceNumbers ?? (shape.sourceNumber === undefined ? [] : [shape.sourceNumber])
    if (
      (shape.sourceNumbers &&
        (shape.sourceNumbers.length < 2 || Object.hasOwn(shape, 'sourceNumber'))) ||
      new Set(numbers).size !== numbers.length
    )
      return { valid: false, missing: [] }
    const members = numbers.length
      ? numbers.map((number) => readings.filter((room) => room.sourceNumber === number))
      : [readings.filter((room) => room.name === shape.name)]
    if (members.some((matches) => matches.length !== 1)) return { valid: false, missing: [] }
    const rooms = members.flat()
    if (rooms.some((room) => covered.has(room))) return { valid: false, missing: [] }
    const expectedName = rooms.map((room) => room.name.trim()).join(' / ')
    if (shape.name !== expectedName) return { valid: false, missing: [] }
    for (const room of rooms) covered.add(room)
  }
  return {
    valid: true,
    missing: readings.filter((room) => !covered.has(room)).map((room) => room.name),
  }
}

/** Создаёт только координатное полотно; геометрию квартиры не угадываем. */
export function manualPlanGeometry(input: unknown): PlanGeometry | null {
  const dimensions = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const { widthCm, heightCm } = dimensions
  if (
    typeof widthCm !== 'number' ||
    typeof heightCm !== 'number' ||
    !Number.isInteger(widthCm) ||
    !Number.isInteger(heightCm) ||
    widthCm < 100 ||
    heightCm < 100 ||
    widthCm > 5_000 ||
    heightCm > 5_000
  ) {
    return null
  }

  return {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm,
    heightCm,
    walls: [],
    openings: [],
    rooms: [],
    warnings: ['Пустое ручное полотно: ни одна стена или комната не распознана автоматически.'],
  }
}

/** Ручные контуры разрешены только для уже названных комнат, без дубликатов. */
export function manualRoomNamesValid(
  submitted: readonly string[],
  known: readonly string[],
): boolean {
  const knownNames = new Set(known)
  return (
    new Set(submitted).size === submitted.length && submitted.every((name) => knownNames.has(name))
  )
}

/** Названия помещений, у которых ещё нет контура. */
export function missingManualRoomNames(
  submitted: readonly string[],
  known: readonly string[],
): string[] {
  const completed = new Set(submitted)
  return [...new Set(known)].filter((name) => !completed.has(name))
}
