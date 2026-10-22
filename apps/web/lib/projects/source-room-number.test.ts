import {
  isPlanRoomSourceNumber,
  planRoomSourceNumbersInScheduleOrder,
} from '@uyut/db/source-room-number'
import { describe, expect, it } from 'vitest'

describe('printed source room identifiers', () => {
  it.each([1, 3, 3.1, 3.01, 3.123, 9999.999, 10_000])('preserves valid identifier %s', (value) => {
    expect(isPlanRoomSourceNumber(value)).toBe(true)
    expect(JSON.parse(JSON.stringify(value))).toBe(value)
  })
  it.each([0, -3, 0.1, 3.1234, 10_000.1, Number.NaN, Number.POSITIVE_INFINITY, '3.1', null, {}])(
    'rejects invalid or nonnumeric identifier %s',
    (value) => {
      expect(isPlanRoomSourceNumber(value)).toBe(false)
    },
  )
  it('does not round a subroom to its parent', () => {
    expect(new Set([3, 3.1])).toHaveLength(2)
    expect(isPlanRoomSourceNumber(3.0000000001)).toBe(false)
  })
  it.each([
    [1, 2, 3],
    [1, 1.1, 2, 3, 3.1, 4],
    [1, 2, 3, 3.2, 3.11, 4],
    // После перепланировки часть номеров исчезает: 1, 2, 4, 6 - обычная экспликация.
    [1, 3],
    [1, 2, 4, 6],
    [1, 1.1, 4, 4.2, 9],
  ])('keeps subroom rows and gaps left by a redrawn plan %#', (...numbers) => {
    expect(planRoomSourceNumbersInScheduleOrder(numbers)).toBe(true)
  })
  it.each([
    [],
    [1.1],
    [2],
    [1, 2, 3, 3.1, 3.1, 4],
    [1, 2, 1.1],
    [3, 4],
    [1, 4, 3],
    [1, 2, 3.1, 3],
    [1, 2, 3.1234],
  ])('refuses incomplete, orphaned or duplicate schedule identifiers %#', (...numbers) => {
    expect(planRoomSourceNumbersInScheduleOrder(numbers)).toBe(false)
  })
})
