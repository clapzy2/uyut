import { validatePlanGeometryEdit } from '@uyut/ai'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
import type { PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { realisticBalconyApartment as fixture } from '../../../../jobs/fixtures/realistic-balcony-apartment'
import { apartmentVolume } from './apartment-volume'
import { kitchenItemIssues } from './kitchen-items'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
  inspectPlanRoomAreas,
} from './plan-geometry-inspection'
import { buildPlanScene } from './plan-scene-geometry'
import { inspectPlanVerticalDimensions } from './plan-vertical-dimensions'
import { planVolume } from './plan-volume'

function shoelaceM2(points: readonly PlanPoint[]): number {
  const sum = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return next ? area + point.xCm * next.yCm - next.xCm * point.yCm : area
  }, 0)
  return Math.abs(sum) / 20_000
}

describe('синтетическая полная квартира с диагональным балконом', () => {
  it('явно помечена тестовой и проходит текущие проверки без геометрических ошибок', () => {
    expect(fixture.synthetic).toBe(true)
    expect(fixture.description).toContain('СИНТЕТИЧЕСКАЯ')
    expect(inspectPlanGeometry(fixture.geometry)).toEqual([])
    expect(inspectManualPlanCompleteness(fixture.geometry)).toEqual([])
    expect(inspectPlanVerticalDimensions(fixture.geometry)).toEqual([])
    expect(inspectPlanRoomAreas(fixture.geometry.rooms, fixture.reading.rooms, true)).toEqual([])
    expect(
      kitchenItemIssues(
        fixture.geometry.kitchenItems ?? [],
        fixture.geometry.widthCm,
        fixture.geometry.heightCm,
        fixture.geometry,
      ),
    ).toEqual([])
  })

  it('считает диагональ и площади по граням, отдельно от габарита и оболочки', () => {
    expect(fixture.reading.rooms.map((room) => room.areaM2)).toEqual([
      4.68, 4.16, 5.72, 19.2, 2.875,
    ])
    expect(fixture.areas.interiorM2).toBeCloseTo(33.76, 10)
    expect(fixture.areas.roomsM2).toBeCloseTo(36.635, 10)
    expect(fixture.areas.balconyM2).toBe((250 * 120 - (50 * 50) / 2) / 10_000)
    expect(fixture.areas.footprintM2).toBeCloseTo(39.115, 10)
    const balcony = fixture.geometry.rooms[4]
    if (!balcony) throw new Error('Missing test balcony')
    expect(shoelaceM2(balcony.polygon)).toBe(2.875)
    const first = balcony.polygon[2]
    const second = balcony.polygon[3]
    if (!first || !second) throw new Error('Missing diagonal endpoints')
    expect(Math.hypot(first.xCm - second.xCm, first.yCm - second.yCm)).toBeCloseTo(
      50 * Math.SQRT2,
      10,
    )
    expect(shoelaceM2(fixture.geometry.footprint ?? [])).toBeCloseTo(39.115, 10)
  })

  it('сохраняет полный обмер в JSON и сохраняет floor-контуры через публичную проверку 2D', () => {
    const restored = JSON.parse(JSON.stringify(fixture)) as typeof fixture
    expect(restored).toEqual(fixture)
    const validated = validatePlanGeometryEdit(restored.geometry, 'confirm')
    expect(validated?.footprint).toEqual(fixture.geometry.footprint)
    expect(validated?.rooms.map((room) => room.polygon)).toEqual(
      fixture.geometry.rooms.map((room) => room.polygon),
    )
    expect(validated?.walls).toHaveLength(fixture.geometry.walls.length)
    expect(validated?.openings).toHaveLength(fixture.geometry.openings.length)
    // Horizontal editing intentionally does not confer vertical measurement evidence.
    expect(
      restored.geometry.walls.every((wall) => wall.measuredThicknessCm && wall.heightCm === 270),
    ).toBe(true)
    expect(
      restored.geometry.openings.every(
        (opening) => opening.bottomCm !== undefined && opening.heightCm !== undefined,
      ),
    ).toBe(true)
  })

  it('показывает один исходный контур пола в настоящей 3D-сцене, не прямоугольник балкона', () => {
    const before = structuredClone(fixture)
    const model = planVolume(fixture.geometry)
    expect(model?.floor).toEqual(fixture.geometry.footprint)
    expect(model?.joinedSolids).toBe(true)
    expect(model?.issues).toEqual([])
    expect(model?.openings.every((opening) => opening.cut)).toBe(true)
    expect(model?.furniture).toHaveLength(5)
    expect(model?.rooms?.find((room) => room.title === 'Балкон')?.floor).toEqual(
      fixture.geometry.rooms[4]?.polygon,
    )
    if (!model) throw new Error('Missing test volume')
    const scene = buildPlanScene(model)
    try {
      const floors = scene.surfaces.filter((surface) => surface.kind === 'floor')
      expect(floors).toHaveLength(1)
      const positions = floors[0]?.geometry.getAttribute('position')
      const polygon = fixture.geometry.footprint ?? []
      expect(positions?.count).toBe(polygon.length)
      polygon.forEach((point, index) => {
        expect(positions?.getX(index)).toBeCloseTo(point.xCm / 100, 6)
        expect(positions?.getZ(index)).toBeCloseTo(point.yCm / 100, 6)
      })
    } finally {
      for (const surface of scene.surfaces) surface.geometry.dispose()
      for (const line of scene.lines) line.geometry.dispose()
    }
    expect(fixture).toEqual(before)
  })

  it('помещает контрольные товары гостиной с их настоящими габаритами без повторного поворота', () => {
    const room = fixture.geometry.rooms.find((candidate) => candidate.sourceNumber === 4)
    const furniture = fixture.furnitureByRoom.find((candidate) => candidate.sourceNumber === 4)
    if (!room || !furniture) throw new Error('Missing living room test inputs')
    const layout = layoutWithMeasurements(
      room.name,
      fixture.measurementsBySourceNumber[4] ?? null,
      fixture.geometry,
      furniture.items,
      'living',
    )
    if (!layout) throw new Error('Missing living room layout')
    expect(layout.placed).toHaveLength(2)
    expect(layout.problems).toEqual([])
    expect(layout.placed.map((item) => [item.xCm, item.yCm, item.widthCm, item.depthCm])).toEqual([
      [160, 260, 150, 223],
      [110, 0, 41, 160],
    ])
    const result = apartmentVolume(fixture.geometry, [
      { roomId: 'synthetic-living', roomName: room.name, layout },
    ])
    expect(result.notes).toEqual([])
    expect(result.model?.issues).toEqual([])
    const sofa = result.model?.furniture?.find((item) => item.itemId === 'divan-263961')
    expect(sofa?.heightCm).toBe(90)
    expect(sofa?.floor[0]).toEqual({ xCm: 480, yCm: 300 })
  })
})
