import { describe, expect, it } from 'vitest'
import {
  findPlanRoomReading,
  manualPlanGeometry,
  manualRoomCoverage,
  manualRoomNamesValid,
  missingManualRoomNames,
  missingManualSourceRooms,
  renamedManualRoomShapes,
} from './manual-plan-geometry'

describe('manual plan geometry', () => {
  it('finds a renamed numbered room with its original utility classification', () => {
    const corridor = { name: 'Коридор', sourceNumber: 5, kind: 'living', utility: true }
    const readings = [corridor, { name: 'Прихожая', sourceNumber: 1, kind: 'living' }]
    expect(findPlanRoomReading({ name: 'Проход', sourceNumber: 5 }, readings)).toBe(corridor)
    expect(findPlanRoomReading({ name: 'Коридор', sourceNumber: 6 }, readings)).toBeUndefined()
  })

  it('does not guess between duplicate printed identities or unnumbered names', () => {
    const readings = [
      { name: 'Спальня', sourceNumber: 5 },
      { name: 'Детская', sourceNumber: 5 },
      { name: 'Кладовая' },
      { name: 'Кладовая' },
    ]
    expect(findPlanRoomReading({ name: 'Спальня', sourceNumber: 5 }, readings)).toBeUndefined()
    expect(findPlanRoomReading({ name: 'Кладовая' }, readings)).toBeUndefined()
    expect(findPlanRoomReading({ name: 'Спальня' }, readings)).toBe(readings[0])
    expect(findPlanRoomReading({ name: 'Кладовая', sourceNumber: 0 }, readings)).toBeUndefined()
  })

  it('renames a numbered contour while retaining its polygon and identity', () => {
    const polygon = [{ xCm: 1, yCm: 2 }]
    const shape = { name: 'Спальня', sourceNumber: 6, polygon }
    const before = [{ name: 'Спальня', sourceNumber: 6 }]
    const after = [{ name: 'Детская', sourceNumber: 6 }]
    const renamed = renamedManualRoomShapes([shape], before, after)
    expect(renamed).toEqual([{ ...shape, name: 'Детская' }])
    expect(renamed[0]?.polygon).toBe(polygon)
    expect(shape.name).toBe('Спальня')
    expect(manualRoomCoverage(renamed, after)).toEqual({ valid: true, missing: [] })
  })

  it('renames shared-zone members in their existing order without splitting the contour', () => {
    const shape = { name: 'Коридор / Прихожая', sourceNumbers: [5, 1], polygon: [] }
    const before = [
      { name: 'Прихожая', sourceNumber: 1 },
      { name: 'Коридор', sourceNumber: 5 },
    ]
    const after = [
      { name: 'Входная зона', sourceNumber: 1 },
      { name: 'Проход', sourceNumber: 5 },
    ]
    const renamed = renamedManualRoomShapes([shape], before, after)
    expect(renamed).toEqual([{ ...shape, name: 'Проход / Входная зона' }])
    expect(renamed[0]?.polygon).toBe(shape.polygon)
    expect(renamed[0]?.sourceNumbers).toBe(shape.sourceNumbers)
    expect(manualRoomCoverage(renamed, after)).toEqual({ valid: true, missing: [] })
  })

  it('leaves contours unchanged when old or new printed identities are ambiguous or missing', () => {
    const shape = { name: 'Спальня', sourceNumber: 6, polygon: [] }
    const before = [{ name: 'Спальня', sourceNumber: 6 }]
    const after = [{ name: 'Детская', sourceNumber: 6 }]
    expect(renamedManualRoomShapes([shape], [...before, ...before], after)[0]).toBe(shape)
    expect(renamedManualRoomShapes([shape], before, [...after, ...after])[0]).toBe(shape)
    expect(renamedManualRoomShapes([shape], before, [])[0]).toBe(shape)
    const staleLabel = { ...shape, name: 'Неизвестная комната' }
    expect(renamedManualRoomShapes([staleLabel], before, after)[0]).toBe(staleLabel)
  })

  it('does not heal duplicate contour ownership, shared identities, or unnumbered names', () => {
    const numbered = { name: 'Спальня', sourceNumber: 6, polygon: [] }
    const shared = { name: 'Спальня / Спальня', sourceNumbers: [6, 6], polygon: [] }
    const unnumbered = { name: 'Спальня', polygon: [] }
    const before = [{ name: 'Спальня', sourceNumber: 6 }]
    const after = [{ name: 'Детская', sourceNumber: 6 }]
    expect(renamedManualRoomShapes([numbered, numbered], before, after)).toEqual([
      numbered,
      numbered,
    ])
    expect(renamedManualRoomShapes([shared], before, after)[0]).toBe(shared)
    expect(renamedManualRoomShapes([unnumbered], before, after)[0]).toBe(unnumbered)
  })

  it('не теряет отсутствующее помещение экспликации после переноса готовых контуров', () => {
    const sources = [
      { sourceNumber: 5, name: 'Спальня' },
      { sourceNumber: 6, name: 'Спальня' },
    ]
    const readings = [{ sourceNumber: 5, name: 'Спальня №05' }]
    const shapes = [{ sourceNumber: 5, name: 'Спальня №05', polygon: [] }]
    expect(missingManualSourceRooms(shapes, readings, sources)).toEqual([
      { ...sources[1], missingFromReading: true },
    ])
    expect(
      missingManualSourceRooms(
        shapes,
        [...readings, { sourceNumber: 6, name: 'Спальня №06' }],
        sources,
      ),
    ).toEqual([{ ...sources[1], missingFromReading: false }])
    expect(
      missingManualSourceRooms(
        [{ name: 'Общая зона', sourceNumbers: [5, 6], polygon: [] }],
        sources,
        sources,
      ),
    ).toEqual([])
    expect(
      missingManualSourceRooms([{ name: 'Спальня', polygon: [] }], readings, sources),
    ).toHaveLength(2)
    expect(missingManualSourceRooms(shapes, readings, [])).toEqual([])
  })
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
