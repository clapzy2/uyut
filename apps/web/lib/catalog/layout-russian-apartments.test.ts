import type {
  FloorKeepClearZone,
  FloorReservation,
  LayoutItem,
  LayoutPoint,
  LayoutRoomKind,
  WallReservation,
} from '@uyut/catalog'
import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import {
  rectBlocksFloorReservation,
  rectInsideFloor,
  rectOverlapsPolygon,
} from '@uyut/catalog/layout'
import { describe, expect, it } from 'vitest'

type ApartmentScenario = {
  name: string
  kind: LayoutRoomKind
  widthCm: number
  depthCm: number
  items: LayoutItem[]
  reservations?: WallReservation[]
  floorPolygon?: LayoutPoint[]
  floorReservations?: FloorReservation[]
  keepClearZones?: FloorKeepClearZone[]
  expected: 'fits' | 'blocked'
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

const door = (wall: WallReservation['wall'], fromCm: number, toCm: number): WallReservation => ({
  kind: 'door',
  wall,
  fromCm,
  toCm,
  clearanceCm: 90,
})

const window = (wall: WallReservation['wall'], fromCm: number, toCm: number): WallReservation => ({
  kind: 'window',
  wall,
  fromCm,
  toCm,
  clearanceCm: 0,
})

const scenarios: ApartmentScenario[] = [
  {
    name: 'спальня 9 м² в типовой однокомнатной квартире',
    kind: 'bedroom',
    widthCm: 300,
    depthCm: 300,
    reservations: [window('top', 90, 210), door('bottom', 0, 80)],
    items: [
      furniture('bed-140', 'Кровать 140', 'bed', 140, 200, {
        operationClearance: { side: 35 },
      }),
      furniture('wardrobe-100', 'Шкаф 100', 'storage', 100, 55, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'спальня 8 м² не обещает двуспальную кровать, шкаф и комод',
    kind: 'bedroom',
    widthCm: 270,
    depthCm: 300,
    reservations: [window('top', 75, 195), door('bottom', 0, 90)],
    items: [
      furniture('large-bed', 'Кровать 180', 'bed', 180, 210, {
        operationClearance: { side: 45 },
      }),
      furniture('large-wardrobe', 'Шкаф 180', 'storage', 180, 60, {
        subcategory: 'wardrobe',
        operationClearance: { front: 55 },
      }),
      furniture('dresser', 'Комод', 'storage', 120, 50, {
        subcategory: 'dresser',
        operationClearance: { front: 45 },
      }),
    ],
    expected: 'blocked',
  },
  {
    name: 'кухня 5,8 м² с линейным гарнитуром и холодильником',
    kind: 'kitchen',
    widthCm: 240,
    depthCm: 242,
    reservations: [window('top', 80, 170), door('bottom', 0, 70)],
    items: [
      furniture('kitchen-run', 'Кухонный гарнитур', 'storage', 180, 60, {
        subcategory: 'cabinet',
        operationClearance: { front: 80 },
      }),
      furniture('fridge', 'Холодильник', 'storage', 60, 65, {
        subcategory: 'wardrobe',
        operationClearance: { front: 70 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'маленькая кухня не принимает остров',
    kind: 'kitchen',
    widthCm: 270,
    depthCm: 300,
    reservations: [window('top', 90, 200), door('bottom', 0, 80)],
    items: [
      furniture('kitchen-run-island', 'Кухонный гарнитур', 'storage', 210, 60, {
        subcategory: 'cabinet',
        operationClearance: { front: 80 },
      }),
      furniture('island', 'Кухонный остров', 'table', 140, 80, {
        subcategory: 'dining',
        operationClearance: { around: 80 },
      }),
    ],
    expected: 'blocked',
  },
  {
    name: 'проходная гостиная с двумя дверями',
    kind: 'living',
    widthCm: 360,
    depthCm: 520,
    reservations: [window('top', 110, 250), door('bottom', 0, 90), door('right', 400, 490)],
    items: [
      furniture('through-sofa', 'Диван', 'sofa', 210, 90, {
        operationClearance: { front: 100 },
      }),
      furniture('through-tv', 'Тумба под ТВ', 'storage', 140, 40, {
        subcategory: 'cabinet',
        operationClearance: { front: 30 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'студия 18 м² с диваном-кроватью и столом на двоих',
    kind: 'living',
    widthCm: 360,
    depthCm: 500,
    reservations: [window('top', 120, 250), door('bottom', 0, 90)],
    items: [
      furniture('studio-sofa', 'Диван-кровать', 'sofa', 200, 90, {
        operationClearance: { front: 120 },
      }),
      furniture('studio-table', 'Стол на двоих', 'table', 80, 70, {
        subcategory: 'dining',
        operationClearance: { around: 55 },
      }),
      furniture('studio-storage', 'Шкаф', 'storage', 120, 55, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'детская 10 м² для школьника',
    kind: 'kid',
    widthCm: 300,
    depthCm: 340,
    reservations: [window('top', 90, 210), door('bottom', 0, 80)],
    items: [
      furniture('kid-bed', 'Кровать', 'bed', 90, 200, {
        operationClearance: { side: 35 },
      }),
      furniture('kid-desk', 'Письменный стол', 'table', 100, 55, {
        subcategory: 'desk',
        operationClearance: { front: 70 },
      }),
      furniture('kid-wardrobe', 'Шкаф', 'storage', 90, 50, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'гостиная с балконным блоком и радиатором',
    kind: 'living',
    widthCm: 420,
    depthCm: 520,
    floorReservations: [
      {
        kind: 'window',
        start: { xCm: 100, yCm: 0 },
        end: { xCm: 250, yCm: 0 },
        clearanceCm: 0,
        sillHeightCm: 85,
      },
      {
        kind: 'balcony',
        start: { xCm: 330, yCm: 0 },
        end: { xCm: 410, yCm: 0 },
        clearanceCm: 0,
      },
    ],
    keepClearZones: [
      {
        kind: 'balcony',
        label: 'Открывание балконной двери',
        polygon: [
          { xCm: 330, yCm: 0 },
          { xCm: 420, yCm: 0 },
          { xCm: 420, yCm: 90 },
          { xCm: 330, yCm: 90 },
        ],
      },
      {
        kind: 'radiator',
        label: 'Радиатор под окном',
        polygon: [
          { xCm: 110, yCm: 0 },
          { xCm: 240, yCm: 0 },
          { xCm: 240, yCm: 35 },
          { xCm: 110, yCm: 35 },
        ],
      },
    ],
    items: [
      furniture('balcony-sofa', 'Диван', 'sofa', 220, 95, {
        operationClearance: { front: 110 },
      }),
      furniture('balcony-tv', 'Тумба под ТВ', 'storage', 150, 40, {
        subcategory: 'cabinet',
        operationClearance: { front: 30 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'Г-образная спальня с нишей под шкаф',
    kind: 'bedroom',
    widthCm: 420,
    depthCm: 480,
    floorPolygon: [
      { xCm: 0, yCm: 0 },
      { xCm: 420, yCm: 0 },
      { xCm: 420, yCm: 180 },
      { xCm: 320, yCm: 180 },
      { xCm: 320, yCm: 480 },
      { xCm: 0, yCm: 480 },
    ],
    floorReservations: [
      {
        kind: 'window',
        start: { xCm: 90, yCm: 0 },
        end: { xCm: 230, yCm: 0 },
        clearanceCm: 0,
        sillHeightCm: 90,
      },
    ],
    items: [
      furniture('niche-bed', 'Кровать 140', 'bed', 140, 200, {
        operationClearance: { side: 35 },
      }),
      furniture('niche-wardrobe', 'Шкаф в нишу', 'storage', 120, 55, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
    expected: 'fits',
  },
  {
    name: 'комната с несущей колонной сохраняет реальный проход',
    kind: 'living',
    widthCm: 390,
    depthCm: 480,
    keepClearZones: [
      {
        kind: 'obstacle',
        label: 'Несущая колонна',
        polygon: [
          { xCm: 170, yCm: 190 },
          { xCm: 220, yCm: 190 },
          { xCm: 220, yCm: 290 },
          { xCm: 170, yCm: 290 },
        ],
      },
    ],
    items: [
      furniture('column-sofa', 'Диван', 'sofa', 200, 90, {
        operationClearance: { front: 100 },
      }),
      furniture('column-tv', 'Тумба под ТВ', 'storage', 140, 40, {
        subcategory: 'cabinet',
        operationClearance: { front: 30 },
      }),
    ],
    expected: 'fits',
  },
]

describe('российские квартирные сценарии', () => {
  it.each(scenarios.filter((scenario) => scenario.expected === 'fits'))(
    '$name получает проверяемую расстановку',
    (scenario) => {
      const layout = layoutRoom(
        {
          roomKind: scenario.kind,
          widthCm: scenario.widthCm,
          depthCm: scenario.depthCm,
          reservations: scenario.reservations ?? [],
          floorPolygon: scenario.floorPolygon,
          floorReservations: scenario.floorReservations ?? [],
          keepClearZones: scenario.keepClearZones ?? [],
        },
        scenario.items,
      )

      expect(layout.problems, scenario.name).toEqual([])
      expect(layout.placed, scenario.name).toHaveLength(scenario.items.length)
      expect(layout.walkwayCm, scenario.name).toBeGreaterThanOrEqual(WALKWAY_CM)
      expect(layout.safetySummary.status, scenario.name).toBe('checked')
      expect(
        layout.placed.every((placement) =>
          rectInsideFloor(
            placement,
            scenario.floorPolygon ?? [
              { xCm: 0, yCm: 0 },
              { xCm: scenario.widthCm, yCm: 0 },
              { xCm: scenario.widthCm, yCm: scenario.depthCm },
              { xCm: 0, yCm: scenario.depthCm },
            ],
          ),
        ),
        scenario.name,
      ).toBe(true)
      expect(
        layout.placed.every((placement) =>
          (scenario.floorReservations ?? []).every(
            (reservation) => !rectBlocksFloorReservation(placement, reservation),
          ),
        ),
        scenario.name,
      ).toBe(true)
      expect(
        layout.placed.every((placement) =>
          (scenario.keepClearZones ?? []).every(
            (zone) => !rectOverlapsPolygon(placement, zone.polygon),
          ),
        ),
        scenario.name,
      ).toBe(true)

      const reversed = layoutRoom(
        {
          roomKind: scenario.kind,
          widthCm: scenario.widthCm,
          depthCm: scenario.depthCm,
          reservations: scenario.reservations ?? [],
          floorPolygon: scenario.floorPolygon,
          floorReservations: scenario.floorReservations ?? [],
          keepClearZones: scenario.keepClearZones ?? [],
        },
        [...scenario.items].reverse(),
      )
      expect(reversed.problems, `${scenario.name}: обратный порядок`).toEqual([])
      expect(reversed.placed, `${scenario.name}: обратный порядок`).toHaveLength(
        scenario.items.length,
      )
      expect(reversed.walkwayCm, `${scenario.name}: обратный порядок`).toBeGreaterThanOrEqual(
        WALKWAY_CM,
      )
    },
  )

  it.each(scenarios.filter((scenario) => scenario.expected === 'blocked'))(
    '$name получает честный отказ',
    (scenario) => {
      const layout = layoutRoom(
        {
          roomKind: scenario.kind,
          widthCm: scenario.widthCm,
          depthCm: scenario.depthCm,
          reservations: scenario.reservations ?? [],
          floorPolygon: scenario.floorPolygon,
          floorReservations: scenario.floorReservations ?? [],
          keepClearZones: scenario.keepClearZones ?? [],
        },
        scenario.items,
      )

      expect(layout.problems.length, scenario.name).toBeGreaterThan(0)
      expect(layout.safetySummary.status, scenario.name).toBe('blocked')
    },
  )
})
