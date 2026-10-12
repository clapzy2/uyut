import type { PlanReading } from '@uyut/db'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import { z } from 'zod'
import { nativePaintedFloorReview } from './plan-native-painted-floor-review'

export type SourceRoomNumberOption = {
  floorId: string
  roomIndex: number
  sourceNumber: number
  sourceRoomKey: string
  name: string
}
type Input = Parameters<typeof nativePaintedFloorReview>[0] & { reading: PlanReading }
const selectionSchema = z
  .object({
    acknowledgement: z.literal(true),
    selections: z
      .array(
        z
          .object({
            floorId: z.string().min(1).max(160),
            roomIndex: z.number().int().min(0).max(199),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()

/** Exact names propose room identities only. Source paint is not physical/metric authority. */
export function planSourceRoomNumberOptions(input: Input) {
  const checked = nativePaintedFloorReview(input)
  const options: SourceRoomNumberOption[] = []
  const finish = (refusalReason: string | null) => ({
    options: refusalReason ? [] : options,
    refusalReason,
    physicalBoundariesAccepted: false as const,
    measurementsConfirmed: false as const,
    commonZeroConfirmed: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  if (checked.refusalReason || checked.status !== 'reviewed-draft')
    return finish(checked.refusalReason ?? 'source-floor-review-unavailable')
  const rooms = input.reading.rooms
  if (
    !Array.isArray(rooms) ||
    rooms.length > 200 ||
    rooms.some(
      (room) =>
        !room ||
        typeof room.name !== 'string' ||
        (room.sourceNumber !== undefined && !isPlanRoomSourceNumber(room.sourceNumber)),
    )
  )
    return finish('invalid-reading-room-inventory')
  const occupied = rooms.flatMap((room) =>
    room.sourceNumber === undefined ? [] : [room.sourceNumber],
  )
  if (new Set(occupied).size !== occupied.length) return finish('duplicate-reading-source-number')
  for (const floor of checked.floors) {
    const key = floor.owner.sourceRoomKey
    const sourceNumber = Number(key)
    if (!isPlanRoomSourceNumber(sourceNumber) || String(sourceNumber) !== key)
      return finish('invalid-source-room-key')
    if (occupied.includes(sourceNumber)) continue
    const name = floor.owner.name.trim()
    const sameOwners = checked.floors.filter((other) => other.owner.name.trim() === name)
    const matchingRooms = rooms
      .map((room, roomIndex) => ({ room, roomIndex }))
      .filter(({ room }) => room.name.trim() === name)
    if (!name || sameOwners.length !== 1 || matchingRooms.length !== 1) continue
    const match = matchingRooms[0]
    if (!match || match.room.sourceNumber !== undefined) continue
    options.push({
      floorId: floor.id,
      roomIndex: match.roomIndex,
      sourceNumber,
      sourceRoomKey: key,
      name,
    })
  }
  return finish(null)
}

/** Explicit human selection acknowledges identity, not contours, units, heights or scale. */
export function recoverPlanSourceRoomNumbers(input: Input, review: unknown) {
  const proposals = planSourceRoomNumberOptions(input)
  if (proposals.refusalReason)
    return { reading: null, mappings: [], refusalReason: proposals.refusalReason }
  const parsed = selectionSchema.safeParse(review)
  if (!parsed.success)
    return { reading: null, mappings: [], refusalReason: 'invalid-source-room-number-selection' }
  const mappings: SourceRoomNumberOption[] = []
  const seenFloors = new Set<string>()
  const seenRooms = new Set<number>()
  for (const selection of parsed.data.selections) {
    const option = proposals.options.find(
      (option) => option.floorId === selection.floorId && option.roomIndex === selection.roomIndex,
    )
    if (!option || seenFloors.has(selection.floorId) || seenRooms.has(selection.roomIndex))
      return {
        reading: null,
        mappings: [],
        refusalReason: 'stale-or-ambiguous-source-room-number-selection',
      }
    seenFloors.add(selection.floorId)
    seenRooms.add(selection.roomIndex)
    mappings.push(option)
  }
  const byRoom = new Map(mappings.map((mapping) => [mapping.roomIndex, mapping.sourceNumber]))
  const reading: PlanReading = {
    ...input.reading,
    rooms: input.reading.rooms.map((room, index) => {
      const sourceNumber = byRoom.get(index)
      return sourceNumber === undefined ? room : { ...room, sourceNumber }
    }),
  }
  return { reading, mappings, refusalReason: null }
}
