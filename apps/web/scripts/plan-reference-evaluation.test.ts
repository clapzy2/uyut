import type { PlanReading } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import { evaluateDeclaredPlanReference, evaluatePlanReference } from './plan-reference-evaluation'

function controlReading(): PlanReading {
  return {
    planState: 'existing',
    totalAreaM2: reference.totalAreaM2,
    rooms: reference.rooms.map((room) => ({
      name: room.name,
      kind: 'bedroom',
      sourceNumber: room.number,
      areaM2: room.areaM2,
      ...(room.widthMm === null ? {} : { widthCm: room.widthMm / 10 }),
      ...(room.depthMm === null ? {} : { depthCm: room.depthMm / 10 }),
      ...(typeof room.ceilingMm === 'number' ? { ceilingCm: room.ceilingMm / 10 } : {}),
    })),
  }
}

describe('reference evaluation is separate from model inference', () => {
  it('counts declared numbers even when the production parser would reject their evidence', () => {
    const result = evaluateDeclaredPlanReference(
      JSON.stringify({
        rooms: [
          {
            name: 'Кухня',
            sourceNumber: 2,
            widthMm: reference.rooms[1]?.widthMm,
            depthMm: 99999,
            measurementEvidence: { width: { textItemIndexes: [-1] } },
          },
        ],
      }),
    )
    expect(result.summary.correctKnownDimensions).toBe(1)
    expect(result.summary.wrongKnownDimensions).toBe(1)
    expect(result.summary.missingKnownDimensions).toBe(10)
  })

  it('does not coerce null or strings into raw numeric declarations', () => {
    const result = evaluateDeclaredPlanReference(
      '```json\n{"rooms":[{"sourceNumber":2,"widthMm":null,"depthMm":"4205"}]}\n```',
    )
    expect(result.summary.wrongKnownDimensions).toBe(0)
    expect(result.summary.missingKnownDimensions).toBe(12)
    expect(() => evaluateDeclaredPlanReference('not json')).toThrow('Нет JSON')
  })

  it('preserves original precision and matches printed numbers regardless of order', () => {
    const reading = controlReading()
    reading.rooms.reverse()
    expect(evaluatePlanReference(reading).summary).toMatchObject({
      uniqueMatchedRooms: 8,
      correctAreas: 8,
      correctKnownDimensions: 12,
      missingKnownDimensions: 0,
      wrongKnownDimensions: 0,
      correctIndividualCeilings: 2,
      unknownReferenceSidesReturned: 0,
    })
  })

  it('does not round a sub-millimetre reading error into an exact control match', () => {
    const reading = controlReading()
    const kitchen = reading.rooms.find((room) => room.sourceNumber === 2)
    const ceilingRoom = reading.rooms.find((room) => room.ceilingCm !== undefined)
    if (kitchen?.widthCm === undefined || ceilingRoom?.ceilingCm === undefined)
      throw new Error('Missing controls')
    kitchen.widthCm -= 0.04
    ceilingRoom.ceilingCm -= 0.04
    const result = evaluatePlanReference(reading)
    expect(result.summary.correctKnownDimensions).toBe(11)
    expect(result.summary.wrongKnownDimensions).toBe(1)
    expect(result.summary.correctIndividualCeilings).toBe(1)
  })

  it('does not choose the first duplicate or identify two bedrooms by answer order', () => {
    const reading = controlReading()
    const bedroom = reading.rooms.find((room) => room.sourceNumber === 4)
    if (!bedroom) throw new Error('Missing control bedroom')
    reading.rooms.push({ ...bedroom })
    const result = evaluatePlanReference(reading)
    expect(result.summary.duplicateRoomNumbers).toEqual([4])
    expect(result.summary.correctKnownDimensions).toBe(10)
    expect(result.rooms.find((room) => room.sourceNumber === 4)?.found).toBe(false)
    for (const room of reading.rooms) delete room.sourceNumber
    expect(evaluatePlanReference(reading).summary.uniqueMatchedRooms).toBe(0)
  })

  it('distinguishes wrong numbers, missing controls and unannotated extra sides', () => {
    const reading = controlReading()
    const kitchen = reading.rooms.find((room) => room.sourceNumber === 2)
    const hall = reading.rooms.find((room) => room.sourceNumber === 1)
    if (!kitchen || !hall) throw new Error('Missing controls')
    kitchen.widthCm = 338.9
    delete kitchen.depthCm
    hall.widthCm = 205
    expect(evaluatePlanReference(reading).summary).toMatchObject({
      correctKnownDimensions: 10,
      wrongKnownDimensions: 1,
      missingKnownDimensions: 1,
      unknownReferenceSidesReturned: 1,
    })
  })

  it('does not interpret no known dimensions as perfect geometry or fill ceilings', () => {
    const reading = controlReading()
    for (const room of reading.rooms) {
      delete room.widthCm
      delete room.depthCm
      delete room.ceilingCm
    }
    reading.ceilingCm = 267
    const result = evaluatePlanReference(reading)
    expect(result.summary).toMatchObject({
      correctKnownDimensions: 0,
      missingKnownDimensions: 12,
      correctIndividualCeilings: 0,
      unexpectedUniformCeiling: true,
    })
    expect(reading.rooms.every((room) => room.ceilingCm === undefined)).toBe(true)
  })
})
