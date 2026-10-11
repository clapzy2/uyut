import { parseFloorPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import native from '../../../../docs/qa/fixtures/basis-native-total-area.json'
import type { PlanMeasurementTextItem } from '../../../../packages/ai/src/floor-plan-measurements'
import { planTotalAreaConflict } from '../../../../packages/ai/src/floor-plan-schedule'

function sourceItems(): PlanMeasurementTextItem[] {
  const items: PlanMeasurementTextItem[] = Array.from(
    { length: native.originalTextItemCount },
    () => ({ text: '', rotation: 0 }),
  )
  for (const { index, ...item } of native.items) items[index] = item
  return items
}

const rooms = [
  { name: 'Помещение', sourceNumber: 1, areaM2: 40.13 },
  { name: 'Балкон 01', sourceNumber: 2, areaM2: 4.75 },
  { name: 'Балкон 02', sourceNumber: 3, areaM2: 3.34 },
]
const read = (totalAreaM2: number | null = 48.22, items = sourceItems()) =>
  parseFloorPlan(JSON.stringify({ planState: 'existing', totalAreaM2, rooms }), {
    requireMeasurementEvidence: true,
    planText: JSON.stringify(items),
  })
const change = (index: number, patch: Partial<PlanMeasurementTextItem>) => {
  const items = sourceItems()
  const item = items[index]
  if (!item) throw new Error('Missing source item')
  items[index] = { ...item, ...patch }
  return items
}

describe('native overall-area ambiguity, not summed or inferred apartment area', () => {
  it.each([48.22, 47.4, 55.55, null])(
    'withholds any model-selected total %s for qualified conflict',
    (total) => {
      const result = read(total)
      expect(result.totalAreaM2).toBeUndefined()
      expect(result.rooms.map((room) => room.areaM2)).toEqual([40.13, 4.75, 3.34])
      for (const room of result.rooms) {
        expect(room.measurementWarnings).toHaveLength(1)
        expect(room.measurementWarnings?.[0]).toContain('48,22 м²')
        expect(room.measurementWarnings?.[0]).toContain('47,4 м²')
        expect(room.measurementWarnings?.[0]).toContain('какие помещения включены')
      }
    },
  )
  it('uses other numbers and does not mutate source labels', () => {
    const items = change(5, { text: 'Общая площадь квартиры: 60,5 м²' })
    if (items[22]) items[22].text = '63,25 м²'
    const before = structuredClone(items)
    expect(planTotalAreaConflict(items)).toEqual({ scheduleAreaM2: 63.25, apartmentAreaM2: 60.5 })
    expect(read(63.25, items).totalAreaM2).toBeUndefined()
    expect(items).toEqual(before)
  })
  it('preserves a non-conflicting total and does not fill a missing model total', () => {
    const items = change(5, { text: 'Квартира 48.22 кв. м.' })
    expect(read(48.22, items).totalAreaM2).toBe(48.22)
    expect(read(null, items).totalAreaM2).toBeUndefined()
    expect(read(48.22, items).rooms.every((room) => !room.measurementWarnings)).toBe(true)
  })
  it.each([
    [5, { text: '' }],
    [22, { text: '' }],
    [22, { text: '48,22' }],
    [22, { x: 600 }],
    [22, { y: 400 }],
    [22, { rotation: 90 }],
    [5, { x: undefined }],
    [5, { text: 'Площадь гостиной 47,4 кв.м.' }],
    [5, { text: 'Квартира №47,4 кв.м.' }],
    [5, { text: 'Площадь квартиры без балкона 47,4 кв.м.' }],
    [5, { text: 'Например, квартира 47,4 кв.м.' }],
    [5, { text: 'Квартира 47,4 кв.м., площадь без балкона' }],
    [13, { text: '04' }],
  ] as const)(
    'does not qualify incomplete, displaced or differently scoped label %s %j',
    (index, patch) => {
      expect(read(48.22, change(index, patch)).totalAreaM2).toBe(48.22)
    },
  )
  it('does not pick a footer among multiple nearby numeric candidates', () => {
    const items = sourceItems()
    items.push({ text: '49,2 м²', x: 940, y: 275, rotation: 0 })
    expect(planTotalAreaConflict(items)).toBeUndefined()
    expect(read(48.22, items).totalAreaM2).toBe(48.22)
  })
  it('does not classify a row with a room name as the total', () => {
    const items = sourceItems()
    items.push({ text: 'Кухня', x: 741, y: 263, rotation: 0 })
    expect(planTotalAreaConflict(items)).toBeUndefined()
  })
  it('refuses duplicate table headers', () => {
    const items = sourceItems()
    items.push({ text: 'Площадь', x: 939, y: 600, rotation: 0 })
    expect(planTotalAreaConflict(items)).toBeUndefined()
  })
  it.each([
    { text: 'Площадь', rotation: 0 },
    { text: 'Площадь', rotation: 90, x: 200, y: 100 },
  ])('ignores earlier unqualified header %j instead of masking the real total', (header) => {
    const items = sourceItems()
    items[0] = header
    expect(planTotalAreaConflict(items)).toEqual({ scheduleAreaM2: 48.22, apartmentAreaM2: 47.4 })
  })
  it('does not keep otherwise rejected empty model rooms because of an area warning', () => {
    const result = parseFloorPlan(
      JSON.stringify({ totalAreaM2: 48.22, rooms: [{ name: 'Лишняя' }] }),
      {
        planText: JSON.stringify(sourceItems()),
      },
    )
    expect(result.rooms).toEqual([])
    expect(result.totalAreaM2).toBeUndefined()
  })
  it('does not claim raster/image-only source verification or infer a total from room areas', () => {
    const result = parseFloorPlan(JSON.stringify({ totalAreaM2: 48.22, rooms }))
    expect(result.totalAreaM2).toBe(48.22)
    expect(result.rooms.every((room) => !room.measurementWarnings)).toBe(true)
    expect(planTotalAreaConflict(undefined)).toBeUndefined()
    expect(read(48.22, change(5, { text: 'Объект №47.4' })).totalAreaM2).toBe(48.22)
  })
})
