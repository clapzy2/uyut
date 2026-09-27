import { parseFloorPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import reference from '../../../../docs/qa/fixtures/apartment-74-77.json'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import type { PlanMeasurementTextItem } from '../../../../packages/ai/src/floor-plan-measurements'
import { planRoomSchedule } from '../../../../packages/ai/src/floor-plan-schedule'
import { planRows } from './plan-rows'

// Keep native indexes stable while excluding the source PDF's personal/address block.
const textItems: PlanMeasurementTextItem[] = Array.from(
  { length: native.originalTextItemCount },
  () => ({ text: '', rotation: 0 }),
)
for (const { index, ...item } of native.items) textItems[index] = item
const options = { requireMeasurementEvidence: true, planText: JSON.stringify(textItems) }
const kitchen = {
  name: 'Кухня',
  sourceNumber: 2,
  areaM2: 12.35,
  widthMm: 2964,
  depthMm: 4205,
  measurementEvidence: {
    width: {
      kind: 'horizontal-chain',
      scope: 'room',
      sourceNumber: 2,
      complete: true,
      segmentsMm: [525, 563, 926, 950],
      textItemIndexes: [7, 19, 8, 9],
    },
    depth: {
      kind: 'vertical-chain',
      scope: 'room',
      sourceNumber: 2,
      complete: true,
      segmentsMm: [3718, 487],
      textItemIndexes: [16, 17],
    },
  },
}
const bedroom = (sourceNumber: number, ceilingMm: number, textIndex: number) => ({
  name: 'Спальня',
  sourceNumber,
  areaM2: sourceNumber === 4 ? 15.39 : 12.23,
  ceilingMm,
  measurementEvidence: {
    ceiling: {
      kind: 'ceiling',
      scope: 'room',
      sourceNumber,
      complete: true,
      segmentsMm: [ceilingMm],
      textItemIndexes: [textIndex],
    },
  },
})
const read = (rooms: unknown[], items = textItems) =>
  parseFloorPlan(JSON.stringify({ planState: 'existing', rooms }), {
    ...options,
    planText: JSON.stringify(items),
  })

describe('sheet 03 native text safeguards, not OCR or leader-line recognition', () => {
  it('reads all eight schedule rows independently of model response order', () => {
    const schedule = planRoomSchedule(textItems)
    expect(schedule?.size).toBe(8)
    for (const room of reference.rooms) {
      expect(schedule?.get(room.number)).toEqual({ name: room.name, areaM2: room.areaM2 })
    }
    expect(read([bedroom(6, 2672, 188), kitchen, bedroom(4, 2663, 186)]).rooms).toMatchObject([
      { sourceNumber: 6, ceilingCm: 267.2 },
      { sourceNumber: 2, widthCm: 296.4, depthCm: 420.5 },
      { sourceNumber: 4, ceilingCm: 266.3 },
    ])
  })

  it('preserves genuine chains on different horizontal and vertical axes', () => {
    expect(read([kitchen]).rooms[0]).toMatchObject({
      widthCm: 296.4,
      depthCm: 420.5,
      areaM2: 12.35,
    })
    const room = read([
      {
        ...bedroom(6, 2672, 188),
        widthMm: 2945,
        depthMm: 4154,
        measurementEvidence: {
          ...bedroom(6, 2672, 188).measurementEvidence,
          width: {
            ...kitchen.measurementEvidence.width,
            sourceNumber: 6,
            segmentsMm: [866, 1353, 726],
            textItemIndexes: [87, 86, 88],
          },
          depth: {
            ...kitchen.measurementEvidence.depth,
            sourceNumber: 6,
            segmentsMm: [4154],
            textItemIndexes: [90],
          },
        },
      },
    ]).rooms[0]
    expect(room).toMatchObject({ widthCm: 294.5, depthCm: 415.4, areaM2: 12.23 })
    expect(room?.measurementWarnings).toBeUndefined()
  })

  it('rejects kitchen measurements relabelled as source room 3, without substituting numbers', () => {
    const room = read([
      {
        ...kitchen,
        sourceNumber: 3,
        measurementEvidence: {
          width: { ...kitchen.measurementEvidence.width, sourceNumber: 3 },
          depth: { ...kitchen.measurementEvidence.depth, sourceNumber: 3 },
        },
      },
    ]).rooms[0]
    expect(room?.widthCm).toBeUndefined()
    expect(room?.depthCm).toBeUndefined()
    expect(room?.areaM2).toBeUndefined()
    expect(room?.measurementWarnings?.join(' ')).toContain('экспликац')
  })

  it('leaves a contradictory area empty but preserves the independent dimensions', () => {
    const reading = read([{ ...kitchen, areaM2: 17.05 }])
    expect(reading.rooms[0]).toMatchObject({ widthCm: 296.4, depthCm: 420.5 })
    expect(reading.rooms[0]?.areaM2).toBeUndefined()
    const rows = planRows({ ...reading, readAt: '2026-09-27T00:00:00.000Z' })
    expect(rows[0]?.area).toBe('')
    expect(rows[0]?.measurementWarnings?.join(' ')).toContain('Площадь')
  })

  it('clears both ceilings when one native callout is assigned to both bedrooms', () => {
    const reading = read([bedroom(4, 2663, 186), bedroom(6, 2663, 186)])
    expect(reading.rooms.map((room) => room.ceilingCm)).toEqual([undefined, undefined])
    expect(reading.rooms.every((room) => room.measurementEvidence === undefined)).toBe(true)
    expect(reading.rooms.every((room) => room.measurementWarnings?.length === 1)).toBe(true)
  })

  it('does not confuse identical numeric ceilings with reuse of one physical label', () => {
    const items = textItems.map((item, index) =>
      index === 188 ? { ...item, text: 'натяжной-2663мм' } : item,
    )
    expect(read([bedroom(4, 2663, 186), bedroom(6, 2663, 188)], items).rooms).toMatchObject([
      { ceilingCm: 266.3 },
      { ceilingCm: 266.3 },
    ])
  })

  it('does not let the first room silently win a shared width label', () => {
    const bedroomWidth = {
      ...bedroom(4, 2663, 186),
      widthMm: 2964,
      measurementEvidence: {
        width: { ...kitchen.measurementEvidence.width, sourceNumber: 4 },
      },
    }
    for (const rooms of [
      [kitchen, bedroomWidth],
      [bedroomWidth, kitchen],
    ]) {
      const reading = read(rooms)
      expect(reading.rooms.every((room) => room.widthCm === undefined)).toBe(true)
      expect(reading.rooms.find((room) => room.sourceNumber === 2)?.depthCm).toBe(420.5)
    }
  })

  it.each(['width', 'depth'] as const)(
    'rejects %s labels moved to different parallel lines',
    (side) => {
      const movedIndex = side === 'width' ? 9 : 17
      const items = textItems.map((item, index) =>
        index === movedIndex ? { ...item, ...(side === 'width' ? { y: 712 } : { x: 783 }) } : item,
      )
      const room = read([kitchen], items).rooms[0]
      expect(room?.[`${side}Cm`]).toBeUndefined()
      expect(room?.areaM2).toBe(12.35)
    },
  )

  it.each([null, -1, 1001])('rejects broken native coordinates %s in a chain', (y) => {
    const items = textItems.map((item, index) => (index === 9 ? { ...item, y } : item))
    const reading = parseFloorPlan(JSON.stringify({ rooms: [kitchen] }), {
      ...options,
      planText: JSON.stringify(items),
    })
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
  })

  it('does not infer a missing schedule row from nearby text', () => {
    const items = textItems.map((item, index) =>
      [116, 117, 118].includes(index) ? { text: '', rotation: 0 } : item,
    )
    expect(planRoomSchedule(items)?.get(2)).toBeUndefined()
    expect(read([kitchen], items).rooms[0]?.widthCm).toBe(296.4)
  })

  it('does not combine ambiguous headings, duplicate room numbers or shifted table columns', () => {
    const duplicateHeading = [
      ...textItems,
      { text: 'Экспликация помещений', x: 600, y: 430, rotation: 0 },
    ]
    const duplicateNumber = textItems.map((item, index) =>
      index === 120 ? { ...item, text: '2' } : item,
    )
    const shiftedColumns = textItems.map((item, index) =>
      index === 118 ? { ...item, x: 400 } : item,
    )
    for (const items of [duplicateHeading, duplicateNumber, shiftedColumns]) {
      expect(planRoomSchedule(items)).toBeUndefined()
    }
  })
})
