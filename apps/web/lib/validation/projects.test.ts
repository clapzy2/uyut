import { describe, expect, it } from 'vitest'
import { projectSettingsSchema, roomSchema } from './projects'

describe('project validation', () => {
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
