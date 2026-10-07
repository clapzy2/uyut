import type { PlanGeometry, PlanRoomReading, PlanRoomShape, RoomSpaceKind } from '@uyut/db'

/** Project balconies need a contour even when they were added after the image was read. */
export function geometryRoomReadings(
  readings: readonly PlanRoomReading[],
  projectRooms: readonly { name: string; spaceKind: RoomSpaceKind; areaM2: number | null }[],
): PlanRoomReading[] {
  const result = [...readings]
  for (const room of projectRooms) {
    if (room.spaceKind === 'interior' || result.some((reading) => reading.name === room.name))
      continue
    result.push({
      name: room.name,
      kind: 'living',
      utility: true,
      spaceKind: room.spaceKind,
      ...(room.areaM2 === null ? {} : { areaM2: room.areaM2 }),
    })
  }
  return result
}

type NamedRoom = { name: string; sourceNumber?: number }

/** Printed identity survives a rename; an ambiguous match must never inherit room metadata. */
export function findPlanRoomReading<T extends NamedRoom>(
  room: NamedRoom,
  readings: readonly T[],
): T | undefined {
  if (
    room.sourceNumber !== undefined &&
    (!Number.isInteger(room.sourceNumber) || room.sourceNumber < 1)
  )
    return undefined
  const matches = readings.filter((reading) =>
    room.sourceNumber === undefined
      ? reading.name === room.name
      : reading.sourceNumber === room.sourceNumber,
  )
  return matches.length === 1 ? matches[0] : undefined
}

/** Follow verified numbered-room renames without repairing uncertain identities or geometry. */
export function renamedManualRoomShapes(
  shapes: readonly PlanRoomShape[],
  beforeReadings: readonly NamedRoom[],
  afterReadings: readonly NamedRoom[],
): PlanRoomShape[] {
  const ownershipCounts = new Map<number, number>()
  for (const shape of shapes) {
    const numbers =
      shape.sourceNumbers ?? (shape.sourceNumber === undefined ? [] : [shape.sourceNumber])
    for (const number of numbers) {
      ownershipCounts.set(number, (ownershipCounts.get(number) ?? 0) + 1)
    }
  }
  return shapes.map((shape) => {
    const numbers =
      shape.sourceNumbers ?? (shape.sourceNumber === undefined ? [] : [shape.sourceNumber])
    if (
      numbers.length === 0 ||
      (shape.sourceNumbers &&
        (shape.sourceNumbers.length < 2 || Object.hasOwn(shape, 'sourceNumber'))) ||
      numbers.some((number) => ownershipCounts.get(number) !== 1)
    )
      return shape
    const beforeRooms = numbers.map((sourceNumber) =>
      findPlanRoomReading({ name: shape.name, sourceNumber }, beforeReadings),
    )
    const afterRooms = numbers.map((sourceNumber) =>
      findPlanRoomReading({ name: shape.name, sourceNumber }, afterReadings),
    )
    if (beforeRooms.some((room) => !room) || afterRooms.some((room) => !room)) return shape
    const previousName = beforeRooms.map((room) => room?.name.trim()).join(' / ')
    if (shape.name !== previousName) return shape
    const nextName = afterRooms.map((room) => room?.name.trim()).join(' / ')
    return nextName === shape.name ? shape : { ...shape, name: nextName }
  })
}

/** The project list must not hide schedule rows that were never imported. */
export function missingManualSourceRooms(
  shapes: readonly PlanRoomShape[],
  readings: readonly NamedRoom[],
  sourceRooms: readonly { name: string; sourceNumber: number }[],
) {
  const readingNumbers = new Set(readings.map((room) => room.sourceNumber))
  const shapeNumbers = new Set(
    shapes.flatMap(
      (room) => room.sourceNumbers ?? (room.sourceNumber === undefined ? [] : [room.sourceNumber]),
    ),
  )
  return sourceRooms
    .filter(
      (room) => !readingNumbers.has(room.sourceNumber) || !shapeNumbers.has(room.sourceNumber),
    )
    .map((room) => ({ ...room, missingFromReading: !readingNumbers.has(room.sourceNumber) }))
}

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
