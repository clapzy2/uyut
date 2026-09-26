import { mergeReadings, parseFloorPlan, parseSideRecheck } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import reference from '../../../../docs/qa/fixtures/apartment-74-77.json'
import { planRoomsSchema } from '../validation/projects'
import { planRows, totalAreaCheck } from './plan-rows'

const raw = {
  planState: reference.source.state,
  totalAreaM2: reference.totalAreaM2,
  ceilingMm: reference.uniformCeilingMm,
  rooms: reference.rooms.map((room) => ({ ...room, sourceNumber: room.number, aspect: 1 })),
}

describe('published apartment: parser regression, not a vision accuracy test', () => {
  it('preserves all printed millimetres and hundredths of square metres', () => {
    const reading = parseFloorPlan(JSON.stringify(raw))
    expect(reading.totalAreaM2).toBe(74.77)
    expect(reading.rooms).toHaveLength(8)
    for (const expected of reference.rooms) {
      const room = reading.rooms.find((room) => room.sourceNumber === expected.number)
      expect(room?.areaM2).toBe(expected.areaM2)
      expect(room?.widthCm).toBe(expected.widthMm === null ? undefined : expected.widthMm / 10)
      expect(room?.depthCm).toBe(expected.depthMm === null ? undefined : expected.depthMm / 10)
      expect(room?.estimated).toBeUndefined()
    }
    expect(reading.ceilingCm).toBeUndefined()
    expect(reading.rooms.find((room) => room.sourceNumber === 4)?.ceilingCm).toBe(266.3)
    expect(reading.rooms.find((room) => room.sourceNumber === 6)?.ceilingCm).toBe(267.2)
  })

  it('identifies bedrooms by printed number even when response order changes', () => {
    const reading = parseFloorPlan(JSON.stringify({ ...raw, rooms: [...raw.rooms].reverse() }))
    expect(reading.rooms.find((room) => room.name === 'Спальня 4')?.areaM2).toBe(15.39)
    expect(reading.rooms.find((room) => room.name === 'Спальня 6')?.areaM2).toBe(12.23)
  })

  it('distinguishes existing, proposed and unknown sheets', () => {
    expect(parseFloorPlan(JSON.stringify(raw)).planState).toBe('existing')
    expect(parseFloorPlan(JSON.stringify({ ...raw, planState: 'proposed' })).planState).toBe(
      'proposed',
    )
    expect(parseFloorPlan(JSON.stringify({ ...raw, planState: 'guessed' })).planState).toBe(
      'unknown',
    )
  })

  it('retains decimal values through the editable form and its validation', () => {
    const reading = parseFloorPlan(JSON.stringify(raw))
    const rows = planRows({ ...reading, readAt: '2026-09-26T00:00:00.000Z' })
    const input = {
      ceilingCm: '',
      condition: 'bare',
      rooms: rows.map((row) => ({
        include: row.include,
        roomId: '',
        name: row.name,
        kind: row.kind,
        sourceNumber: row.sourceNumber,
        ceilingCm: row.ceiling ?? '',
        widthCm: row.width,
        depthCm: row.depth,
        areaM2: row.area,
        wish: '',
      })),
    }
    const saved = planRoomsSchema.parse(input)
    expect(saved.rooms.find((room) => room.sourceNumber === 2)).toMatchObject({
      widthCm: 296.4,
      depthCm: 420.5,
      areaM2: 12.35,
    })
    expect(saved.rooms.find((room) => room.sourceNumber === 1)).toMatchObject({
      widthCm: null,
      depthCm: null,
    })
    expect(saved.rooms.find((room) => room.sourceNumber === 4)?.ceilingCm).toBe(266.3)
    expect(totalAreaCheck(rows, reading.totalAreaM2)).toEqual({
      sum: '74,77',
      total: '74,77',
      agrees: true,
    })
  })

  it('adds chain segments locally without rounding away millimetres', () => {
    expect(
      parseSideRecheck(JSON.stringify({ segments: [525, 563, 926, 950], totalMm: 2999 })),
    ).toBe(296.4)
  })

  it('cannot combine measured and proposed sheets into one reading', () => {
    const existing = parseFloorPlan(JSON.stringify(raw))
    const proposed = parseFloorPlan(JSON.stringify({ ...raw, planState: 'proposed' }))
    expect(() => mergeReadings([existing, proposed])).toThrow('Нельзя объединять')
    expect(mergeReadings([existing]).planState).toBe('existing')
  })

  it('keeps separate rows if a reader repeats the same printed number', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        rooms: [
          { name: 'Спальня', sourceNumber: 4, widthMm: 2985 },
          { name: 'Спальня', sourceNumber: 4, widthMm: 2945 },
        ],
      }),
    )
    expect(new Set(reading.rooms.map((room) => room.name)).size).toBe(2)
    expect(reading.rooms.every((room) => room.sourceNumber === undefined)).toBe(true)
  })

  it('does not spread an inconsistent shared ceiling across rooms', () => {
    const reading = parseFloorPlan(JSON.stringify({ ...raw, ceilingMm: 2700 }))
    expect(reading.ceilingCm).toBeUndefined()
    expect(reading.rooms.find((room) => room.sourceNumber === 4)?.ceilingCm).toBe(266.3)
    expect(reading.rooms.find((room) => room.sourceNumber === 6)?.ceilingCm).toBe(267.2)
  })
})
