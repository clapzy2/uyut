import type { PlanGeometry, PlanKitchenItem, PlanUtilityPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { inspectRoutes, inspectUtilities, kitchenSafetySchema } from './kitchen-safety'

const topLeft = { xCm: 0, yCm: 0 }
const topRight = { xCm: 500, yCm: 0 }
const bottomRight = { xCm: 500, yCm: 400 }
const bottomLeft = { xCm: 0, yCm: 400 }
const room = [topLeft, topRight, bottomRight, bottomLeft]
const door = {
  id: 'door',
  type: 'door' as const,
  wallId: 'top',
  offsetCm: 80,
  widthCm: 100,
  clearance: { side: 'left' as const, depthCm: 100, shape: 'rectangle' as const },
}
const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 500,
  heightCm: 400,
  warnings: [],
  rooms: [{ name: 'Кухня', polygon: room }],
  walls: [
    { id: 'top', kind: 'outer', start: topLeft, end: topRight },
    { id: 'right', kind: 'outer', start: topRight, end: bottomRight },
    { id: 'bottom', kind: 'outer', start: bottomRight, end: bottomLeft },
    { id: 'left', kind: 'outer', start: bottomLeft, end: topLeft },
  ],
  openings: [door],
  routeWidthCm: 70,
}
const fridge: PlanKitchenItem = {
  id: 'fridge',
  kind: 'fridge',
  xCm: 350,
  yCm: 100,
  widthCm: 60,
  depthCm: 60,
  front: 'left',
}

describe('инженерия кухни и непрерывные маршруты', () => {
  it('не подменяет неизвестные подключения стандартными числами', () => {
    const result = inspectUtilities([fridge], [])
    expect(result.issues).toEqual([])
    expect(result.missing.join(' ')).toContain('Розетка')
  })
  it('сравнивает реальное расстояние до прямоугольника с явно заданной длиной', () => {
    const socket: PlanUtilityPoint = {
      id: 'socket',
      kind: 'socket',
      xCm: 250,
      yCm: 130,
      reachCm: 99,
    }
    expect(inspectUtilities([fridge], [socket]).issues.join(' ')).toContain('дальше')
    expect(inspectUtilities([fridge], [{ ...socket, reachCm: 100 }]).issues).toEqual([])
  })
  it('проверяет радиатор и точки вне комнаты', () => {
    const radiator: PlanUtilityPoint = {
      id: 'radiator',
      kind: 'radiator',
      xCm: 330,
      yCm: 130,
      reachCm: 25,
    }
    expect(inspectUtilities([fridge], [radiator], geometry).issues.join(' ')).toContain('радиатора')
    expect(
      inspectUtilities([fridge], [{ ...radiator, xCm: 550 }], geometry).issues.join(' '),
    ).toContain('вне контуров')
  })
  it('находит маршрут от дверного проёма к фасаду', () => {
    const result = inspectRoutes([fridge], geometry)
    expect(result.issues).toEqual([])
    expect(result.paths[0]?.length).toBeGreaterThan(2)
    expect(result.resolutionCm).toBe(10)
  })
  it('не пропускает маршрут сквозь внутреннюю стену без проёма', () => {
    const barrier = {
      id: 'barrier',
      kind: 'inner' as const,
      start: { xCm: 250, yCm: 0 },
      end: { xCm: 250, yCm: 400 },
    }
    expect(
      inspectRoutes([fridge], { ...geometry, walls: [...geometry.walls, barrier] }).issues.join(
        ' ',
      ),
    ).toContain('Нет непрерывного маршрута')
  })
  it('не пропускает маршрут сквозь неподвижное препятствие', () => {
    const obstacle = {
      id: 'manual_0123456789abcdef01234567',
      kind: 'shaft' as const,
      xCm: 220,
      yCm: 0,
      widthCm: 80,
      depthCm: 400,
    }
    expect(
      inspectRoutes([fridge], { ...geometry, obstacles: [obstacle] }).issues.join(' '),
    ).toContain('Нет непрерывного маршрута')
  })
  it('пропускает маршрут через явно заданный проём во внутренней стене', () => {
    const barrier = {
      id: 'barrier',
      kind: 'inner' as const,
      start: { xCm: 250, yCm: 0 },
      end: { xCm: 250, yCm: 400 },
    }
    const innerDoor = {
      id: 'inner-door',
      type: 'door' as const,
      wallId: 'barrier',
      offsetCm: 150,
      widthCm: 100,
    }
    expect(
      inspectRoutes([fridge], {
        ...geometry,
        walls: [...geometry.walls, barrier],
        openings: [...geometry.openings, innerDoor],
      }).issues,
    ).toEqual([])
  })
  it('не считает окно проходом и учитывает ширину дверного проёма', () => {
    expect(inspectRoutes([fridge], { ...geometry, routeWidthCm: 110 }).issues.join(' ')).toContain(
      'Стартовый проём уже маршрута',
    )
    const windowOnly: PlanGeometry = {
      ...geometry,
      openings: [{ ...door, type: 'window', clearance: undefined }],
    }
    expect(inspectRoutes([fridge], windowOnly).missing.join(' ')).toContain('двери')
  })
  it('просит выбрать старт при нескольких настроенных дверях', () => {
    const secondDoor = { ...door, id: 'door-two', offsetCm: 300 }
    expect(
      inspectRoutes([fridge], { ...geometry, openings: [door, secondDoor] }).missing.join(' '),
    ).toContain('Выберите стартовую дверь')
    expect(
      inspectRoutes([fridge], {
        ...geometry,
        openings: [door, secondDoor],
        routeStartOpeningId: 'door',
      }).issues,
    ).toEqual([])
  })
  it('валидирует границы данных до сохранения', () => {
    expect(
      kitchenSafetySchema.safeParse({
        routeWidthCm: 39,
        utilityPoints: [],
      }).success,
    ).toBe(false)
    expect(
      kitchenSafetySchema.safeParse({
        routeWidthCm: 70.5,
        utilityPoints: [{ id: 'socket', kind: 'socket', xCm: 1.5, yCm: 2.5, reachCm: 80.5 }],
      }).success,
    ).toBe(true)
  })
  it('проверяет все подключения посудомоечной машины отдельно от шкафа', () => {
    const dishwasher: PlanKitchenItem = {
      id: 'dishwasher',
      kind: 'dishwasher',
      xCm: 200,
      yCm: 100,
      widthCm: 60,
      depthCm: 60,
    }
    const incomplete = inspectUtilities(
      [dishwasher],
      [{ id: 'water', kind: 'water', xCm: 200, yCm: 100, reachCm: 20 }],
    )
    expect(incomplete.missing.join(' ')).toContain('Канализация')
    expect(incomplete.missing.join(' ')).toContain('Розетка')
    const points: PlanUtilityPoint[] = [
      { id: 'water', kind: 'water', xCm: 200, yCm: 100, reachCm: 20 },
      { id: 'drain', kind: 'drain', xCm: 200, yCm: 100, reachCm: 20 },
      { id: 'socket', kind: 'socket', xCm: 200, yCm: 100, reachCm: 20 },
    ]
    expect(inspectUtilities([dishwasher], points).missing).toEqual([])
  })

  it('не считает духовку обычным шкафом и требует её подключение', () => {
    const oven: PlanKitchenItem = {
      id: 'oven',
      kind: 'oven',
      xCm: 200,
      yCm: 100,
      widthCm: 60,
      depthCm: 60,
    }
    expect(inspectUtilities([oven], []).missing.join(' ')).toContain('подключение духовки')
    expect(
      inspectUtilities([oven], [{ id: 'socket', kind: 'socket', xCm: 200, yCm: 100, reachCm: 20 }])
        .missing,
    ).toEqual([])
    expect(
      inspectUtilities(
        [oven],
        [{ id: 'socket', kind: 'socket', xCm: 100, yCm: 100, reachCm: 39 }],
      ).issues.join(' '),
    ).toContain('дальше заданной длины')
  })
})
