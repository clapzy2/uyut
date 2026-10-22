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
/**
 * Номера в экспликации идут по возрастанию, но не обязаны идти подряд: после
 * перепланировки часть номеров исчезает, и на реальных листах встречается 1, 2, 4, 6.
 * Возрастание и уникальность по-прежнему защищают от прочитанного не того столбца,
 * а подномер обязан принадлежать последнему целому номеру.
 */
export function planRoomSourceNumbersInScheduleOrder(numbers: readonly number[]): boolean {
  const seen = new Set<number>()
  let parent = 0
  for (const number of numbers) {
    if (!isPlanRoomSourceNumber(number) || seen.has(number)) return false
    seen.add(number)
    if (Number.isInteger(number)) {
      // Нумерация начинается с единицы и только растёт. Пропуск допустим, движение
      // назад - нет: так прочитанный не тот столбец всё ещё виден.
      if (number <= parent || (parent === 0 && number !== 1)) return false
      parent = number
    } else if (parent === 0 || Math.floor(number) !== parent) {
      return false
    }
  }
  return numbers.length > 0
}
