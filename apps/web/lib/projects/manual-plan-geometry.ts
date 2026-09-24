import type { PlanGeometry } from '@uyut/db'

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
