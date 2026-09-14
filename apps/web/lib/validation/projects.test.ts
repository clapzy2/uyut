import { describe, expect, it } from 'vitest'
import {
  planRoomsSchema,
  projectSettingsSchema,
  roomMeasurementsSchema,
  roomSchema,
} from './projects'

describe('project validation', () => {
  it('проверяет описание архитектуры в мерках и при подтверждении плана', () => {
    const measurements = {
      ceilingCm: '',
      widthCm: '208',
      depthCm: '260',
      layoutNotes: '  Окно снизу  ',
    }
    expect(roomMeasurementsSchema.parse(measurements).layoutNotes).toBe('Окно снизу')
    expect(
      roomMeasurementsSchema.safeParse({ ...measurements, layoutNotes: 'x'.repeat(801) }).success,
    ).toBe(false)
    expect(roomMeasurementsSchema.parse({ ...measurements, layoutNotes: '' }).layoutNotes).toBe('')
    expect(
      roomMeasurementsSchema.parse({ ...measurements, layoutNotes: undefined }).layoutNotes,
    ).toBeUndefined()
    const plan = {
      ceilingCm: '',
      condition: 'bare',
      rooms: [
        {
          include: true,
          roomId: '',
          name: 'Кухня',
          kind: 'kitchen',
          widthCm: '208',
          depthCm: '260',
          areaM2: '5,4',
          wish: '',
          layoutNotes: 'Окно снизу',
        },
      ],
    }
    expect(planRoomsSchema.parse(plan).rooms[0]?.layoutNotes).toBe('Окно снизу')
    expect(
      planRoomsSchema.safeParse({ ...plan, rooms: [{ ...plan.rooms[0], layoutNotes: 42 }] })
        .success,
    ).toBe(false)
  })
  it('turns empty optional fields into null and accepts a comma decimal', () => {
    const result = projectSettingsSchema.parse({
      title: '  Квартира на Ленина ',
      houseSeries: '',
      totalAreaM2: '54,5',
    })
    expect(result).toEqual({ title: 'Квартира на Ленина', houseSeries: null, totalAreaM2: 54.5 })
  })

  it('rejects a non-numeric area with a plain message', () => {
    const result = projectSettingsSchema.safeParse({
      title: 'x',
      houseSeries: '',
      totalAreaM2: 'много',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Введите число')
    }
  })

  it('allows only the three room kinds of the mvp', () => {
    expect(roomSchema.safeParse({ kind: 'bath', name: 'Ванная', areaM2: '' }).success).toBe(false)
    expect(roomSchema.parse({ kind: 'kitchen', name: 'Кухня', areaM2: '9,3' })).toEqual({
      kind: 'kitchen',
      name: 'Кухня',
      areaM2: 9.3,
    })
  })
})
