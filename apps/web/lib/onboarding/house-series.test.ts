import { describe, expect, it } from 'vitest'
import {
  apartmentSchema,
  BUDGET_MAX_KOPECKS,
  BUDGET_MIN_KOPECKS,
  budgetSchema,
  householdSchema,
} from '../validation/onboarding'
import { findSeries, houseSeries, seriesLayout, totalAreaOf } from './house-series'

describe('house series', () => {
  it('у каждой серии есть человеческое пояснение', () => {
    expect(houseSeries.length).toBeGreaterThanOrEqual(6)
    for (const series of houseSeries) {
      expect(series.hint.length).toBeGreaterThan(10)
    }
  })

  it('однокомнатная это гостиная и кухня, трёхкомнатная добавляет две спальни', () => {
    const one = seriesLayout('p-44', 1)
    expect(one.map((room) => room.kind)).toEqual(['living', 'kitchen'])
    const three = seriesLayout('p-44', 3)
    expect(three.map((room) => room.kind)).toEqual(['living', 'bedroom', 'bedroom', 'kitchen'])
    expect(three.every((room) => room.areaM2 > 0)).toBe(true)
  })

  it('неизвестная серия даёт пустой набор, а не падает', () => {
    expect(findSeries('нет-такой')).toBeUndefined()
    expect(seriesLayout('нет-такой', 2)).toEqual([])
  })

  it('к жилой площади добавляются коридор и санузел', () => {
    const rooms = seriesLayout('p-44', 2)
    const living = rooms.reduce((sum, room) => sum + room.areaM2, 0)
    expect(totalAreaOf(rooms)).toBeGreaterThan(living)
  })
})

describe('onboarding validation', () => {
  it('квартира вручную требует хотя бы одну комнату', () => {
    const empty = apartmentSchema.safeParse({
      mode: 'manual',
      title: 'Дом',
      totalAreaM2: null,
      rooms: [],
    })
    expect(empty.success).toBe(false)
  })

  it('серия принимает только один, два или три', () => {
    expect(
      apartmentSchema.safeParse({ mode: 'series', title: 'Дом', seriesId: 'p-44', roomCount: 2 })
        .success,
    ).toBe(true)
    expect(
      apartmentSchema.safeParse({ mode: 'series', title: 'Дом', seriesId: 'p-44', roomCount: 5 })
        .success,
    ).toBe(false)
  })

  it('бюджет держится в границах слайдера', () => {
    expect(budgetSchema.safeParse({ budgetKopecks: BUDGET_MIN_KOPECKS }).success).toBe(true)
    expect(budgetSchema.safeParse({ budgetKopecks: BUDGET_MAX_KOPECKS }).success).toBe(true)
    expect(budgetSchema.safeParse({ budgetKopecks: BUDGET_MIN_KOPECKS - 1 }).success).toBe(false)
    expect(budgetSchema.safeParse({ budgetKopecks: BUDGET_MAX_KOPECKS + 1 }).success).toBe(false)
  })

  it('в семье не бывает нуля взрослых', () => {
    const base = { kids: 0, pets: false, cookHome: true, receiveGuests: false, wfh: false }
    expect(householdSchema.safeParse({ ...base, adults: 1 }).success).toBe(true)
    expect(householdSchema.safeParse({ ...base, adults: 0 }).success).toBe(false)
  })
})
