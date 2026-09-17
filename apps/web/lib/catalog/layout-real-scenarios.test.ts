import type { LayoutItem, LayoutRoomKind, WallReservation } from '@uyut/catalog'
import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

type Scenario = {
  name: string
  kind: LayoutRoomKind
  widthCm: number
  depthCm: number
  reservations: WallReservation[]
  items: LayoutItem[]
}

const furniture = (
  id: string,
  title: string,
  category: LayoutItem['category'],
  width: number,
  depth: number,
  extra: Partial<LayoutItem> = {},
): LayoutItem => ({
  id,
  title,
  category,
  dimensions: { width, depth, height: 90 },
  quantity: 1,
  ...extra,
})

const scenarios: Scenario[] = [
  {
    name: 'спальня с двуспальной кроватью и хранением',
    kind: 'bedroom',
    widthCm: 420,
    depthCm: 480,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 120, toCm: 300, clearanceCm: 0 },
      { kind: 'door', wall: 'bottom', fromCm: 20, toCm: 110, clearanceCm: 90 },
    ],
    items: [
      furniture('bed', 'Кровать 160', 'bed', 160, 200, {
        operationClearance: { side: 45 },
      }),
      furniture('wardrobe', 'Шкаф', 'storage', 180, 60, {
        subcategory: 'wardrobe',
        operationClearance: { front: 55 },
      }),
      furniture('dresser', 'Комод', 'storage', 100, 45, {
        subcategory: 'dresser',
        operationClearance: { front: 45 },
      }),
    ],
  },
  {
    name: 'гостиная с раскладным диваном и журнальным столом',
    kind: 'living',
    widthCm: 480,
    depthCm: 560,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 150, toCm: 330, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 420, toCm: 510, clearanceCm: 90 },
    ],
    items: [
      furniture('sofa', 'Раскладной диван', 'sofa', 240, 95, {
        operationClearance: { front: 130 },
      }),
      furniture('tv', 'Тумба под ТВ', 'storage', 180, 45, {
        subcategory: 'cabinet',
        operationClearance: { front: 30 },
      }),
      furniture('coffee', 'Журнальный стол', 'table', 100, 55, {
        subcategory: 'coffee',
        operationClearance: { around: 35 },
      }),
    ],
  },
  {
    name: 'детская со спальным и рабочим местом',
    kind: 'kid',
    widthCm: 400,
    depthCm: 480,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 120, toCm: 240, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 380, toCm: 470, clearanceCm: 90 },
    ],
    items: [
      furniture('bed', 'Односпальная кровать', 'bed', 90, 200, {
        operationClearance: { side: 40 },
      }),
      furniture('desk', 'Письменный стол', 'table', 120, 60, {
        subcategory: 'desk',
        operationClearance: { front: 80 },
      }),
      furniture('wardrobe', 'Детский шкаф', 'storage', 100, 55, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
  },
  {
    name: 'кухня со столовой зоной и высоким шкафом',
    kind: 'kitchen',
    widthCm: 420,
    depthCm: 480,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 120, toCm: 240, clearanceCm: 0 },
      { kind: 'door', wall: 'bottom', fromCm: 0, toCm: 90, clearanceCm: 90 },
    ],
    items: [
      furniture('table', 'Обеденный стол', 'table', 110, 70, {
        subcategory: 'dining',
        operationClearance: { around: 65 },
      }),
      furniture('cabinet', 'Кухонный пенал', 'storage', 80, 60, {
        subcategory: 'wardrobe',
        operationClearance: { front: 80 },
      }),
    ],
  },
  {
    name: 'небольшая спальня с кроватью и шкафом',
    kind: 'bedroom',
    widthCm: 300,
    depthCm: 360,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 90, toCm: 210, clearanceCm: 0 },
      { kind: 'door', wall: 'bottom', fromCm: 0, toCm: 80, clearanceCm: 80 },
    ],
    items: [
      furniture('bed', 'Кровать 140', 'bed', 140, 200, {
        operationClearance: { side: 40 },
      }),
      furniture('wardrobe', 'Шкаф 120', 'storage', 120, 60, {
        subcategory: 'wardrobe',
        operationClearance: { front: 50 },
      }),
    ],
  },
  {
    name: 'узкая кухня с рабочей линией и холодильником',
    kind: 'kitchen',
    widthCm: 240,
    depthCm: 320,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 80, toCm: 180, clearanceCm: 0 },
      { kind: 'door', wall: 'bottom', fromCm: 0, toCm: 80, clearanceCm: 80 },
    ],
    items: [
      furniture('run', 'Рабочая линия', 'storage', 180, 60, {
        subcategory: 'cabinet',
        operationClearance: { front: 80 },
      }),
      furniture('fridge', 'Холодильник', 'storage', 60, 65, {
        subcategory: 'wardrobe',
        operationClearance: { front: 70 },
      }),
    ],
  },
  {
    name: 'компактная детская со столом у свободной стены',
    kind: 'kid',
    widthCm: 320,
    depthCm: 420,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 100, toCm: 220, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 330, toCm: 410, clearanceCm: 80 },
    ],
    items: [
      furniture('bed', 'Односпальная кровать', 'bed', 90, 200, {
        operationClearance: { side: 35 },
      }),
      furniture('desk', 'Письменный стол', 'table', 100, 55, {
        subcategory: 'desk',
        operationClearance: { front: 70 },
      }),
      furniture('wardrobe', 'Шкаф', 'storage', 90, 50, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
  },
  {
    name: 'студия с диваном, ТВ и обеденным местом',
    kind: 'living',
    widthCm: 330,
    depthCm: 500,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 100, toCm: 230, clearanceCm: 0 },
      { kind: 'door', wall: 'bottom', fromCm: 0, toCm: 90, clearanceCm: 90 },
    ],
    items: [
      furniture('sofa', 'Диван', 'sofa', 200, 90, {
        operationClearance: { front: 110 },
      }),
      furniture('tv', 'Тумба под ТВ', 'storage', 140, 40, {
        subcategory: 'cabinet',
        operationClearance: { front: 30 },
      }),
      furniture('table', 'Стол на двоих', 'table', 80, 70, {
        subcategory: 'dining',
        operationClearance: { around: 55 },
      }),
    ],
  },
]

describe('реалистичные сценарии комнат', () => {
  it.each(scenarios)('$name проходит с точными габаритами и рабочими зонами', (scenario) => {
    const layout = layoutRoom(
      {
        roomKind: scenario.kind,
        widthCm: scenario.widthCm,
        depthCm: scenario.depthCm,
        reservations: scenario.reservations,
        floorReservations: [],
      },
      scenario.items,
    )

    expect(layout.alternativesEvaluated).toBeGreaterThan(1)
    expect(layout.problems, scenario.name).toEqual([])
    expect(layout.placed, scenario.name).toHaveLength(scenario.items.length)
    expect(layout.walkwayCm, scenario.name).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(layout.safetySummary.status, scenario.name).toBe('checked')
  })

  it.each(scenarios)('$name не зависит от порядка строк списка покупок', (scenario) => {
    const room = {
      roomKind: scenario.kind,
      widthCm: scenario.widthCm,
      depthCm: scenario.depthCm,
      reservations: scenario.reservations,
      floorReservations: [],
    } as const
    const direct = layoutRoom(room, scenario.items)
    const reversed = layoutRoom(room, [...scenario.items].reverse())

    expect(reversed.problems, scenario.name).toEqual(direct.problems)
    expect(reversed.placed, scenario.name).toHaveLength(direct.placed.length)
    expect(reversed.walkwayCm, scenario.name).toBe(direct.walkwayCm)
    expect(reversed.safetySummary.status, scenario.name).toBe(direct.safetySummary.status)
  })

  it('учитывает диван, ТВ-зону и журнальный стол при выборе гостиной', () => {
    const scenario = scenarios.find((entry) => entry.kind === 'living') as Scenario
    const layout = layoutRoom(
      {
        roomKind: scenario.kind,
        widthCm: scenario.widthCm,
        depthCm: scenario.depthCm,
        reservations: scenario.reservations,
        floorReservations: [],
      },
      scenario.items,
    )

    expect(layout.relationships.find((relation) => relation.kind === 'sofa-tv')).toMatchObject({
      status: 'checked',
    })
    expect(layout.relationships.find((relation) => relation.kind === 'sofa-coffee')).toMatchObject({
      status: 'checked',
      distanceCm: expect.any(Number),
    })
  })

  it('не выдумывает расположение окна для рабочего стола', () => {
    const scenario = scenarios.find((entry) => entry.kind === 'kid') as Scenario
    const withoutWindow = layoutRoom(
      {
        roomKind: 'kid',
        widthCm: scenario.widthCm,
        depthCm: scenario.depthCm,
        reservations: [],
        floorReservations: [],
      },
      scenario.items,
    )
    const withWindow = layoutRoom(
      {
        roomKind: 'kid',
        widthCm: scenario.widthCm,
        depthCm: scenario.depthCm,
        reservations: [],
        floorReservations: [
          {
            kind: 'window',
            start: { xCm: 120, yCm: 0 },
            end: { xCm: 240, yCm: 0 },
            clearanceCm: 0,
            sillHeightCm: 90,
          },
        ],
      },
      scenario.items,
    )

    expect(
      withoutWindow.relationships.find((relation) => relation.kind === 'desk-window'),
    ).toMatchObject({
      status: 'needs-data',
    })
    expect(
      withWindow.relationships.find((relation) => relation.kind === 'desk-window'),
    ).toMatchObject({
      status: 'review',
      distanceCm: expect.any(Number),
    })
  })
})
