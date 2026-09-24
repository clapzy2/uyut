import { describe, expect, it } from 'vitest'
import { manualPlanGeometry, manualRoomNamesValid } from './manual-plan-geometry'

describe('manual plan geometry', () => {
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
})
