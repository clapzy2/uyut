import { describe, expect, it } from 'vitest'
import {
  manualPlanGeometry,
  manualRoomCoverage,
  manualRoomNamesValid,
  missingManualRoomNames,
} from './manual-plan-geometry'

describe('manual plan geometry', () => {
  it('covers two schedule rows with one shared physical zone', () => {
    const readings = [
      { name: 'Прихожая', sourceNumber: 1 },
      { name: 'Коридор', sourceNumber: 5 },
    ]
    const shared = { name: 'Прихожая / Коридор', sourceNumbers: [1, 5], polygon: [] }
    expect(manualRoomCoverage([shared], readings)).toEqual({ valid: true, missing: [] })
    expect(
      manualRoomCoverage([shared, { name: 'Коридор', sourceNumber: 5, polygon: [] }], readings)
        .valid,
    ).toBe(false)
    expect(manualRoomCoverage([{ ...shared, sourceNumbers: [1, 9] }], readings).valid).toBe(false)
    expect(manualRoomCoverage([], readings).missing).toEqual(['Прихожая', 'Коридор'])
  })
  it('starts with an empty draft instead of imagined walls or rooms', () => {
    expect(manualPlanGeometry({ widthCm: 850, heightCm: 620 })).toMatchObject({
      source: 'manual',
      status: 'draft',
      widthCm: 850,
      heightCm: 620,
      walls: [],
      openings: [],
      rooms: [],
    })
  })

  it.each([
    null,
    { widthCm: 0, heightCm: 400 },
    { widthCm: 5010, heightCm: 400 },
    { widthCm: '850', heightCm: 620 },
    { widthCm: 850.5, heightCm: 620 },
  ])('rejects dimensions outside the manual canvas contract: %j', (input) => {
    expect(manualPlanGeometry(input)).toBeNull()
  })

  it('keeps manually drawn contours tied to the confirmed room list', () => {
    expect(manualRoomNamesValid(['Кухня'], ['Кухня', 'Гостиная'])).toBe(true)
    expect(manualRoomNamesValid(['Кухня', 'Кухня'], ['Кухня'])).toBe(false)
    expect(manualRoomNamesValid(['Спальня'], ['Кухня'])).toBe(false)
  })

  it('shows which rooms remain before confirming the entire apartment', () => {
    expect(missingManualRoomNames(['Кухня'], ['Кухня', 'Гостиная', 'Прихожая'])).toEqual([
      'Гостиная',
      'Прихожая',
    ])
  })
})
