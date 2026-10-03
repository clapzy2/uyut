import { validatePlanGeometryEdit } from '@uyut/ai'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  applyPlanVerticalDimensions,
  inspectPlanVerticalDimensions,
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
  it('добавляет отдельно заданные мерки после проверки горизонтальной геометрии', () => {
    const input = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270.5 })),
      openings: geometry.openings.map((opening) => ({
        ...opening,
        bottomCm: 50.5,
        heightCm: 140.2,
      })),
    }
    const horizontal = validatePlanGeometryEdit(input, 'draft')
    expect(horizontal?.walls[0]).not.toHaveProperty('heightCm')
    expect(horizontal?.openings[0]).not.toHaveProperty('bottomCm')
    if (!horizontal) throw new Error('Missing horizontal geometry')
    const result = applyPlanVerticalDimensions(horizontal, input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]?.heightCm).toBe(270.5)
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
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270 })),
      openings: geometry.openings.map((opening) => ({ ...opening, bottomCm: 50, heightCm: 140 })),
    }
    const result = applyPlanVerticalDimensions(before, geometry)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]).not.toHaveProperty('heightCm')
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
})
