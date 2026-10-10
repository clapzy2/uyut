import { validatePlanGeometryEdit } from '@uyut/ai'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  applyPlanVerticalDimensions,
  inspectPlanVerticalDimensions,
  openingFloorLevel,
  planVerticalMeasurementReport,
} from './plan-vertical-dimensions'

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 400,
  heightCm: 300,
  walls: [{ id: 'wall', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 }, kind: 'outer' }],
  openings: [
    { id: 'window', type: 'window', wallId: 'wall', offsetCm: 100, widthCm: 100, sillHeightCm: 80 },
  ],
  rooms: [],
  warnings: [],
}

describe('мерки по высоте', () => {
  it('не принимает некорректную толщину и не переносит распознанную в мерку', () => {
    const source = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, thicknessCm: 20 })),
    }
    const result = applyPlanVerticalDimensions(source, source)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]?.thicknessCm).toBe(20)
    expect(result.geometry.walls[0]).not.toHaveProperty('measuredThicknessCm')
    for (const measuredThicknessCm of [0, -1, 101, Number.NaN, Infinity]) {
      const invalid = {
        ...source,
        walls: source.walls.map((wall) => ({ ...wall, measuredThicknessCm })),
      }
      expect(applyPlanVerticalDimensions(source, invalid).ok).toBe(false)
      expect(inspectPlanVerticalDimensions(invalid)[0]?.wallIds).toEqual(['wall'])
    }
  })
  it('добавляет отдельно заданные мерки после проверки горизонтальной геометрии', () => {
    const input = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({
        ...wall,
        heightCm: 270.5,
        measuredThicknessCm: 12.5,
      })),
      openings: geometry.openings.map((opening) => ({
        ...opening,
        bottomCm: 50.5,
        heightCm: 140.2,
      })),
    }
    const horizontal = validatePlanGeometryEdit(input, 'draft')
    expect(horizontal?.walls[0]).not.toHaveProperty('heightCm')
    expect(horizontal?.walls[0]).not.toHaveProperty('measuredThicknessCm')
    expect(horizontal?.openings[0]).not.toHaveProperty('bottomCm')
    if (!horizontal) throw new Error('Missing horizontal geometry')
    const result = applyPlanVerticalDimensions(horizontal, input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]?.heightCm).toBe(270.5)
    expect(result.geometry.walls[0]?.measuredThicknessCm).toBe(12.5)
    expect(result.geometry.openings[0]).toMatchObject({ bottomCm: 50.5, heightCm: 140.2 })
  })

  it('не подставляет высоту подоконника или нулевой низ при пустых полях', () => {
    const result = applyPlanVerticalDimensions(geometry, geometry)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.openings[0]?.sillHeightCm).toBe(80)
    expect(result.geometry.openings[0]).not.toHaveProperty('bottomCm')
    expect(result.geometry.openings[0]).not.toHaveProperty('heightCm')
    expect(result.geometry.walls[0]).not.toHaveProperty('heightCm')
  })

  it('очищает прежние мерки при удалении значений в редакторе', () => {
    const before = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270, measuredThicknessCm: 12 })),
      openings: geometry.openings.map((opening) => ({ ...opening, bottomCm: 50, heightCm: 140 })),
    }
    const result = applyPlanVerticalDimensions(before, geometry)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]).not.toHaveProperty('heightCm')
    expect(result.geometry.walls[0]).not.toHaveProperty('measuredThicknessCm')
    expect(result.geometry.openings[0]).not.toHaveProperty('bottomCm')
  })

  it('показывает противоречие по конкретному проёму и отклоняет сохранение', () => {
    const invalid = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270 })),
      openings: geometry.openings.map((opening) => ({ ...opening, bottomCm: 150, heightCm: 140 })),
    }
    expect(inspectPlanVerticalDimensions(invalid)[0]?.openingIds).toEqual(['window'])
    expect(applyPlanVerticalDimensions(geometry, invalid).ok).toBe(false)
    expect(
      applyPlanVerticalDimensions(geometry, {
        ...invalid,
        walls: [{ id: 'wall', heightCm: Number.NaN }],
      }).ok,
    ).toBe(false)
  })

  it.each([
    'duplicate-wall',
    'duplicate-opening',
    'unknown-wall',
    'unknown-opening',
    'missing-wall',
    'missing-opening',
    'trimmed-id',
  ])('не принимает изменившийся или неоднозначный список мерок: %s', (kind) => {
    const input = structuredClone(geometry)
    if (kind === 'duplicate-wall')
      input.walls.push(structuredClone(input.walls[0] as PlanGeometry['walls'][number]))
    if (kind === 'duplicate-opening')
      input.openings.push(structuredClone(input.openings[0] as PlanGeometry['openings'][number]))
    if (kind === 'unknown-wall' && input.walls[0]) input.walls[0].id = 'another-wall'
    if (kind === 'unknown-opening' && input.openings[0]) input.openings[0].id = 'another-opening'
    if (kind === 'missing-wall') input.walls = []
    if (kind === 'missing-opening') input.openings = []
    if (kind === 'trimmed-id' && input.walls[0]) input.walls[0].id = ' wall '
    const before = structuredClone(geometry)
    expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(false)
    expect(geometry).toEqual(before)
  })

  it('отклоняет невозможный верх проёма даже при неизвестной высоте стены', () => {
    const input = structuredClone(geometry)
    const opening = input.openings[0]
    if (!opening) throw new Error('Missing opening')
    opening.bottomCm = 500
    opening.heightCm = 101
    expect(inspectPlanVerticalDimensions(input)[0]?.openingIds).toEqual(['window'])
    expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(false)
    opening.heightCm = 100
    expect(inspectPlanVerticalDimensions(input)).toEqual([])
  })

  it('удерживает высоты без стены-хозяина и повторяющиеся идентификаторы', () => {
    const input = structuredClone(geometry)
    if (input.openings[0]) input.openings[0].wallId = 'removed'
    expect(inspectPlanVerticalDimensions(input)[0]?.openingIds).toEqual(['window'])
    expect(planVerticalMeasurementReport(input).surfaceStatus).toBe('invalid')
    input.walls.push(structuredClone(input.walls[0] as PlanGeometry['walls'][number]))
    expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('vertical-element-identity')
  })

  it.each(['', ' ', ' wall ', 'a'.repeat(101)])(
    'не объявляет полными мерки с недопустимым существующим ID: %s',
    (id) => {
      const input = structuredClone(geometry)
      const wall = input.walls[0]
      const opening = input.openings[0]
      if (!wall || !opening) throw new Error('Missing geometry')
      wall.id = id
      wall.heightCm = 270
      wall.measuredThicknessCm = 10
      opening.wallId = id
      opening.bottomCm = 0
      opening.heightCm = 210
      expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('vertical-element-identity')
      expect(planVerticalMeasurementReport(input).surfaceStatus).toBe('invalid')
      expect(applyPlanVerticalDimensions(input, input).ok).toBe(false)
    },
  )

  it('отделяет полноту высот от неизвестной толщины и не подставляет нулевой порог', () => {
    const source = structuredClone(geometry)
    const opening = source.openings[0]
    const wall = source.walls[0]
    if (!opening || !wall) throw new Error('Missing fixture')
    opening.type = 'balcony'
    expect(planVerticalMeasurementReport(source)).toMatchObject({
      surfaceStatus: 'partial',
      unknownThresholdIds: ['window'],
      raisedThresholdIds: [],
    })
    opening.bottomCm = 0
    opening.heightCm = 210
    wall.heightCm = 270
    expect(planVerticalMeasurementReport(source)).toMatchObject({
      surfaceStatus: 'complete',
      missingWallThicknessIds: ['wall'],
      unknownThresholdIds: [],
      raisedThresholdIds: [],
    })
    opening.bottomCm = 0.000000001
    expect(planVerticalMeasurementReport(source).raisedThresholdIds).toEqual(['window'])
    expect(openingFloorLevel(opening)).toBe('raised')
    delete opening.bottomCm
    expect(openingFloorLevel(opening)).toBe('unknown')
  })
})
