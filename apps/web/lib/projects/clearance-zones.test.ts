import type { PlanGeometry, PlanKitchenItem, PlanOpening } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  doorClearanceZone,
  inspectClearances,
  kitchenClearanceZones,
  openingClearancesSchema,
  polygonsOverlap,
  rectPolygon,
  rotateKitchenItem,
} from './clearance-zones'
import { kitchenItemsSchema } from './kitchen-items'

const item: PlanKitchenItem = {
  id: 'a',
  kind: 'fridge',
  xCm: 100,
  yCm: 100,
  widthCm: 60,
  depthCm: 50,
}
const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 500,
  heightCm: 400,
  warnings: [],
  rooms: [{ name: 'Кухня', polygon: rectPolygon({ xCm: 0, yCm: 0, widthCm: 500, depthCm: 400 }) }],
  walls: [{ id: 'w', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 500, yCm: 0 } }],
  openings: [],
}
const door: PlanOpening = {
  id: 'd',
  type: 'door',
  wallId: 'w',
  offsetCm: 100,
  widthCm: 80,
  clearance: { side: 'left', depthCm: 120 },
}

describe('явные резервы открывания и монтажа', () => {
  it('не выдумывает размеры для старого проекта', () => {
    const result = inspectClearances([item], {
      ...geometry,
      openings: [{ ...door, clearance: undefined }],
    })
    expect(result.zones).toEqual([])
    expect(result.missing).toHaveLength(3)
  })
  it.each(['top', 'right', 'bottom', 'left'] as const)(
    'суммирует дверцу и проход со стороны %s',
    (front) => {
      const zone = kitchenClearanceZones(
        { ...item, front, openingDepthCm: 40, passageCm: 70 },
        0,
      )[0]
      expect(zone?.rect?.[front === 'top' || front === 'bottom' ? 'depthCm' : 'widthCm']).toBe(110)
      expect(polygonsOverlap(zone?.polygon ?? [], rectPolygon(item))).toBe(false)
    },
  )
  it('выявляет занятую зону и сохраняет свободное касание', () => {
    const withAccess = { ...item, front: 'right' as const, openingDepthCm: 40, passageCm: 70 }
    expect(
      inspectClearances([withAccess, { ...item, id: 'b', xCm: 200 }], geometry).issues.join(' '),
    ).toContain('занята модулем 2')
    expect(
      inspectClearances([withAccess, { ...item, id: 'b', xCm: 270 }], geometry).issues,
    ).toEqual([])
  })
  it('проверяет монтажный габарит относительно стены и соседнего модуля', () => {
    const spaced = { ...item, installationGaps: { top: 0, right: 5, bottom: 0, left: 0 } }
    expect(
      inspectClearances([spaced, { ...item, id: 'b', xCm: 163 }], geometry).issues.join(' '),
    ).toContain('монтажный габарит')
    expect(inspectClearances([{ ...spaced, xCm: 440 }], geometry).issues.join(' ')).toContain(
      'выходит за контур',
    )
  })
  it('поворачивает зазоры и фасад; четыре поворота возвращают исходное', () => {
    const original = {
      ...item,
      front: 'top' as const,
      installationGaps: { top: 1, right: 2, bottom: 3, left: 4 },
    }
    expect(rotateKitchenItem(original).installationGaps).toEqual({
      top: 4,
      right: 1,
      bottom: 2,
      left: 3,
    })
    expect(rotateKitchenItem(original).front).toBe('right')
    expect(
      rotateKitchenItem(rotateKitchenItem(rotateKitchenItem(rotateKitchenItem(original)))),
    ).toEqual(original)
  })
  it('резерв двери ловит мебель не только на линии проёма', () => {
    expect(inspectClearances([item], { ...geometry, openings: [door] }).issues.join(' ')).toContain(
      'Дверь d: свободная зона занята',
    )
    const flipped = doorClearanceZone(
      { ...door, clearance: { side: 'right', depthCm: 120 } },
      geometry,
    )
    expect(flipped?.polygon[2]?.yCm).toBe(-120)
  })
  it('не называет балконный блок обычной дверью', () => {
    expect(doorClearanceZone({ ...door, type: 'balcony' }, geometry)?.label).toBe(
      'Балконный блок d: свободная зона',
    )
  })
  it('строит четверть окружности от выбранных петель', () => {
    const start = doorClearanceZone(
      {
        ...door,
        clearance: { side: 'left', depthCm: 80, shape: 'swing', hinge: 'start' },
      },
      geometry,
    )
    const end = doorClearanceZone(
      { ...door, clearance: { side: 'left', depthCm: 80, shape: 'swing', hinge: 'end' } },
      geometry,
    )
    expect(start?.polygon).toHaveLength(26)
    expect(start?.polygon[0]).toEqual({ xCm: 100, yCm: 0 })
    expect(start?.polygon.at(-1)?.xCm).toBeCloseTo(100)
    expect(start?.polygon.at(-1)?.yCm).toBeCloseTo(80)
    expect(end?.polygon[0]).toEqual({ xCm: 180, yCm: 0 })
    expect(end?.polygon.at(-1)?.yCm).toBeCloseTo(80)
  })
  it('резерв вдоль диагональной стены остаётся повёрнутым, не bounding box', () => {
    const diagonal = {
      ...geometry,
      walls: [
        {
          ...geometry.walls[0],
          id: 'w',
          kind: 'outer' as const,
          start: { xCm: 0, yCm: 0 },
          end: { xCm: 300, yCm: 300 },
        },
      ],
    }
    const zone = doorClearanceZone(door, diagonal)
    expect(zone?.polygon[0]?.xCm).toBeCloseTo(100 / Math.SQRT2)
    expect(zone?.polygon[2]?.xCm).toBeCloseTo(60 / Math.SQRT2)
  })
  it('находит стену в проходе, но допускает касание граничной стены', () => {
    const access = { ...item, front: 'right' as const, openingDepthCm: 40, passageCm: 70 }
    const obstacle = {
      id: 'inner',
      kind: 'inner' as const,
      start: { xCm: 200, yCm: 0 },
      end: { xCm: 200, yCm: 400 },
    }
    expect(
      inspectClearances([access], {
        ...geometry,
        walls: [...geometry.walls, obstacle],
      }).issues.join(' '),
    ).toContain('линию стены inner')
    expect(inspectClearances([access], geometry).issues).toEqual([])
  })
  it('проверяет данные на сервере и сохраняет явный ноль', () => {
    expect(kitchenItemsSchema.parse([{ ...item, openingDepthCm: 0 }])[0]?.openingDepthCm).toBe(0)
    expect(kitchenItemsSchema.safeParse([{ ...item, passageCm: -1 }]).success).toBe(false)
    expect(kitchenItemsSchema.safeParse([{ ...item, openingDepthCm: Infinity }]).success).toBe(
      false,
    )
    expect(
      openingClearancesSchema.safeParse([{ id: 'd', clearance: { side: 'left', depthCm: 0 } }])
        .success,
    ).toBe(false)
    expect(openingClearancesSchema.parse([door])[0]?.clearance).toEqual(door.clearance)
    expect(
      openingClearancesSchema.parse([
        {
          ...door,
          sillHeightCm: 84.5,
          clearance: { side: 'left', depthCm: 80, shape: 'swing', hinge: 'end' },
        },
      ])[0],
    ).toEqual({
      id: 'd',
      sillHeightCm: 84.5,
      clearance: { side: 'left', depthCm: 80, shape: 'swing', hinge: 'end' },
    })
  })
})
