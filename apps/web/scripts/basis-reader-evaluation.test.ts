import type { PlanReading } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import { compareBasisReadings, evaluateBasisReader } from './basis-reader-evaluation'

const reading = (): PlanReading => ({
  planState: 'existing',
  totalAreaM2: 48.22,
  rooms: [
    {
      name: 'Помещение',
      sourceNumber: 1,
      kind: 'living',
      areaM2: 40.13,
      widthCm: 708.8,
      depthCm: 583.2,
    },
    { name: 'Балкон 01', sourceNumber: 2, kind: 'living', spaceKind: 'balcony', areaM2: 4.75 },
    { name: 'Балкон 02', sourceNumber: 3, kind: 'living', spaceKind: 'balcony', areaM2: 3.34 },
  ],
})
describe('BASIS labels, spans and source conflicts stay distinct', () => {
  it('does not declare source correctness even when labels and spans agree', () => {
    const result = evaluateBasisReader(reading())
    expect(result.inventoryPass).toBe(true)
    expect(result.rooms.every((room) => room.areaLabelPass)).toBe(true)
    expect(result.mainEnvelope.depthDeltaCm).toBe(0)
    expect(result.totalArea.resolved).toBe(false)
    expect(result.readyFor3D).toBe(false)
  })
  it('does not silently pick table over title or infer missing dimensions', () => {
    const input = reading()
    input.totalAreaM2 = 47.4
    delete input.rooms[0]?.depthCm
    const result = evaluateBasisReader(input)
    expect(result.totalArea.selectedLabel).toBe('title')
    expect(result.mainEnvelope.depthDeltaCm).toBeNull()
    expect(input.totalAreaM2).toBe(47.4)
  })
  it('detects nested-segment double counting and invented functional rooms', () => {
    const input = reading()
    const main = input.rooms[0]
    if (!main) throw new Error('Missing room')
    main.depthCm = (3069 + 340 + 2763) / 10
    input.rooms.push({ name: 'Кухня', kind: 'kitchen', sourceNumber: 4 })
    const result = evaluateBasisReader(input)
    expect(result.mainEnvelope.depthDeltaCm).toBeCloseTo(34)
    expect(result.inventoryPass).toBe(false)
    expect(result.unexpectedRooms).toHaveLength(1)
  })
  it('does not match missing or duplicated IDs by answer order', () => {
    const input = reading()
    delete input.rooms[0]?.sourceNumber
    expect(evaluateBasisReader(input).rooms[0]?.matchCount).toBe(0)
    const first = reading()
    first.rooms.push(structuredClone(first.rooms[0] ?? { name: 'x', kind: 'living' }))
    expect(evaluateBasisReader(first).rooms[0]?.matchCount).toBe(2)
  })
  it('agreement cannot promote geometry; different dimensions are not repeatable', () => {
    const first = reading(),
      second = reading()
    expect(compareBasisReadings(first, second).agreementProvesCorrectness).toBe(false)
    if (second.rooms[0]) second.rooms[0].depthCm = 617.2
    expect(compareBasisReadings(first, second).roomValuesRepeat).toBe(false)
  })
  it('flags repeated wrong balcony depths without assigning table numbers to contours', () => {
    const input = reading()
    if (input.rooms[1]) input.rooms[1].depthCm = 112.4
    if (input.rooms[2]) input.rooms[2].depthCm = 112.4
    const result = evaluateBasisReader(input)
    expect(result.balconyDepth.map((room) => room.depthDeltaCm)).toEqual([-1, -1])
    expect(result.balconyDepth.every((room) => !room.numberToSpatialContourVerified)).toBe(true)
    const repeat = compareBasisReadings(input, structuredClone(input))
    expect(repeat.roomValuesRepeat).toBe(true)
    expect(repeat.agreementProvesCorrectness).toBe(false)
  })
  it('does not call withheld total area a resolution of conflicting source labels', () => {
    const input = reading()
    delete input.totalAreaM2
    const result = evaluateBasisReader(input)
    expect(result.totalArea.conflictWithheld).toBe(true)
    expect(result.totalArea.resolved).toBe(false)
  })
  it('includes ceiling and room semantics in repeated values', () => {
    const first = reading()
    const second = reading()
    if (second.rooms[0]) second.rooms[0].ceilingCm = 265
    expect(compareBasisReadings(first, second).roomValuesRepeat).toBe(false)
    expect(evaluateBasisReader(second).ceilingPass).toBe(false)
    second.totalAreaM2 = 47.4
    expect(compareBasisReadings(first, second).apartmentValuesRepeat).toBe(false)
  })
  it('missing rooms or geometry are unavailable comparisons, not repeated shapes', () => {
    expect(compareBasisReadings({ rooms: [] }, { rooms: [] }).roomValuesRepeat).toBeNull()
    expect(compareBasisReadings(reading(), reading()).geometryExactRepeat).toBeNull()
  })
})
