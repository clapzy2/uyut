import type { LayoutItem, LayoutRoomKind } from '@uyut/catalog'
import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

type Scenario = {
  name: string
  kind: LayoutRoomKind
  widthCm: number
  depthCm: number
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
]

describe('реалистичные сценарии комнат', () => {
  it.each(scenarios)('$name проходит с точными габаритами и рабочими зонами', (scenario) => {
    const layout = layoutRoom(
      {
        roomKind: scenario.kind,
        widthCm: scenario.widthCm,
        depthCm: scenario.depthCm,
        reservations: [],
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
      reservations: [],
      floorReservations: [],
    } as const
    const direct = layoutRoom(room, scenario.items)
    const reversed = layoutRoom(room, [...scenario.items].reverse())

    expect(reversed.problems, scenario.name).toEqual(direct.problems)
    expect(reversed.placed, scenario.name).toHaveLength(direct.placed.length)
    expect(reversed.walkwayCm, scenario.name).toBe(direct.walkwayCm)
    expect(reversed.safetySummary.status, scenario.name).toBe(direct.safetySummary.status)
  })
})
