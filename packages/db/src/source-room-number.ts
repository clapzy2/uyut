/** Printed room identifiers, not measurements or array positions. 3 and 3.1
 * remain different identifiers; accepting one never supplies geometry or scale.
 * This module is dependency-free so source editors can share the server contract.
 */
export function isPlanRoomSourceNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 10_000 &&
    /^[1-9]\d{0,4}(?:\.\d{1,3})?$/.test(String(value))
  )
}

/** A complete printed schedule starts with 1 and retains ordered whole-room
 * rows. Optional subrooms belong to the preceding parent; they do not advance
 * the whole-room counter or imply that any unprinted subroom exists.
 */
export function planRoomSourceNumbersInScheduleOrder(numbers: readonly number[]): boolean {
  const seen = new Set<number>()
  let expectedParent = 1
  for (const number of numbers) {
    if (!isPlanRoomSourceNumber(number) || seen.has(number)) return false
    seen.add(number)
    if (Number.isInteger(number)) {
      if (number !== expectedParent) return false
      expectedParent++
    } else if (Math.floor(number) !== expectedParent - 1) {
      return false
    }
  }
  return numbers.length > 0
}
