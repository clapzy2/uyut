import { describe, expect, it } from 'vitest'
import { estimateProject, itemTotalKopecks } from './estimate'

const rates = { roughRubPerM2: 15_000, finishRubPerM2: 5_000 }

describe('estimateProject', () => {
  it('charges rough and finish works for a bare room', () => {
    const estimate = estimateProject({
      rooms: [
        { id: 'r1', name: 'Гостиная', areaM2: 18.4, condition: 'bare', refreshFinish: false },
      ],
      items: [],
      budgetKopecks: null,
      rates,
    })
    expect(estimate.works.roughKopecks).toBe(276_000_00)
    expect(estimate.works.finishKopecks).toBe(92_000_00)
    expect(estimate.works.totalKopecks).toBe(368_000_00)
    expect(estimate.works.rooms[0]?.kind).toBe('full')
  })

  it('charges nothing for a finished room unless the owner wants a fresh finish', () => {
    const finished = { id: 'r2', name: 'Спальня', areaM2: 12, condition: 'finished' as const }
    const untouched = estimateProject({
      rooms: [{ ...finished, refreshFinish: false }],
      items: [],
      budgetKopecks: null,
      rates,
    })
    expect(untouched.works.totalKopecks).toBe(0)
    expect(untouched.works.rooms[0]?.kind).toBe('none')

    const refreshed = estimateProject({
      rooms: [{ ...finished, refreshFinish: true }],
      items: [],
      budgetKopecks: null,
      rates,
    })
    expect(refreshed.works.totalKopecks).toBe(60_000_00)
    expect(refreshed.works.rooms[0]?.kind).toBe('finish')
  })

  it('skips rooms without area and names them', () => {
    const estimate = estimateProject({
      rooms: [
        { id: 'r1', name: 'Кухня', areaM2: null, condition: 'bare', refreshFinish: false },
        { id: 'r2', name: 'Гостиная', areaM2: 10, condition: 'bare', refreshFinish: false },
      ],
      items: [],
      budgetKopecks: null,
      rates,
    })
    expect(estimate.works.roomsWithoutArea).toEqual(['Кухня'])
    expect(estimate.works.areaM2).toBe(10)
    expect(estimate.works.totalKopecks).toBe(200_000_00)
  })

  it('sums furniture with quantity and variant price', () => {
    expect(itemTotalKopecks({ priceKopecks: 2_990_00, quantity: 2 })).toBe(5_980_00)
    expect(
      itemTotalKopecks({ priceKopecks: 2_990_00, quantity: 1, variantPriceKopecks: 3_490_00 }),
    ).toBe(3_490_00)
    const estimate = estimateProject({
      rooms: [],
      items: [
        { priceKopecks: 67_900_00, quantity: 1 },
        { priceKopecks: 2_990_00, quantity: 2 },
      ],
      budgetKopecks: null,
      rates,
    })
    expect(estimate.furnitureKopecks).toBe(73_880_00)
    expect(estimate.totalKopecks).toBe(73_880_00)
  })

  it('splits the budget bar into furniture, works and free shares', () => {
    const estimate = estimateProject({
      rooms: [{ id: 'r1', name: 'Гостиная', areaM2: 20, condition: 'bare', refreshFinish: false }],
      items: [{ priceKopecks: 100_000_00, quantity: 1 }],
      budgetKopecks: 1_000_000_00,
      rates,
    })
    expect(estimate.shares.furniture).toBeCloseTo(0.1)
    expect(estimate.shares.works).toBeCloseTo(0.4)
    expect(estimate.shares.free).toBeCloseTo(0.5)
    expect(estimate.remainingKopecks).toBe(500_000_00)
    expect(estimate.overBudget).toBe(false)
  })

  it('caps shares and flags an overrun when the estimate exceeds the budget', () => {
    const estimate = estimateProject({
      rooms: [{ id: 'r1', name: 'Гостиная', areaM2: 50, condition: 'bare', refreshFinish: false }],
      items: [{ priceKopecks: 300_000_00, quantity: 1 }],
      budgetKopecks: 500_000_00,
      rates,
    })
    expect(estimate.overBudget).toBe(true)
    expect(estimate.remainingKopecks).toBe(-800_000_00)
    expect(estimate.shares.furniture + estimate.shares.works).toBeLessThanOrEqual(1)
    expect(estimate.shares.free).toBe(0)
  })

  it('uses the total as the base when there is no budget', () => {
    const estimate = estimateProject({
      rooms: [],
      items: [{ priceKopecks: 50_000_00, quantity: 1 }],
      budgetKopecks: null,
      rates,
    })
    expect(estimate.budgetKopecks).toBeNull()
    expect(estimate.remainingKopecks).toBeNull()
    expect(estimate.shares.furniture).toBe(1)
    expect(estimate.shares.free).toBe(0)
  })
})
