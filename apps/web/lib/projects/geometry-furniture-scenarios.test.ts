import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import {
  rectBlocksFloorReservation,
  rectInsideFloor,
  rectOverlapsPolygon,
} from '@uyut/catalog/layout'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

const lShapedBedroom: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 420,
  heightCm: 480,
  warnings: [],
  walls: [
    { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 420, yCm: 0 } },
    { id: 'notch', kind: 'inner', start: { xCm: 300, yCm: 180 }, end: { xCm: 300, yCm: 480 } },
  ],
  openings: [
    { id: 'window', type: 'window', wallId: 'top', offsetCm: 90, widthCm: 140, sillHeightCm: 90 },
    {
      id: 'door',
      type: 'door',
      wallId: 'notch',
      offsetCm: 50,
      widthCm: 90,
      clearance: { side: 'left', depthCm: 90, shape: 'rectangle' },
    },
  ],
  rooms: [
    {
      name: 'Спальня',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 420, yCm: 0 },
        { xCm: 420, yCm: 180 },
        { xCm: 300, yCm: 180 },
        { xCm: 300, yCm: 480 },
        { xCm: 0, yCm: 480 },
      ],
    },
  ],
}

const entryRoom: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 300,
  heightCm: 360,
  warnings: [],
  walls: [
    { id: 'bottom', kind: 'outer', start: { xCm: 300, yCm: 360 }, end: { xCm: 0, yCm: 360 } },
  ],
  openings: [
    {
      id: 'entry',
      type: 'door',
      wallId: 'bottom',
      offsetCm: 220,
      widthCm: 80,
      clearance: { side: 'left', depthCm: 80, shape: 'rectangle' },
    },
  ],
  rooms: [
    {
      name: 'Гостиная',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 300, yCm: 0 },
        { xCm: 300, yCm: 360 },
        { xCm: 0, yCm: 360 },
      ],
    },
  ],
}

describe('передача подтверждённой геометрии в расстановку мебели', () => {
  it('не считает доступной комнату, если подтверждённая колонна закрывает вход', () => {
    const geometry: PlanGeometry = {
      ...entryRoom,
      obstacles: [
        { id: 'column-at-entry', kind: 'column', xCm: 0, yCm: 280, widthCm: 100, depthCm: 80 },
      ],
    }
    const input = roomLayoutInputFromGeometry(geometry, 'Гостиная', null)
    expect(input?.keepClearZones.some((zone) => zone.kind === 'obstacle')).toBe(true)
    if (!input) return

    const layout = layoutRoom({ ...input, roomKind: 'living', roomName: 'Гостиная' }, [])

    expect(layout.walkwayCm).toBeLessThan(WALKWAY_CM)
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('сохраняет узкий проход в подтверждённом плане и не выдаёт его за свободный', () => {
    const polygon = [
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 120 },
      { xCm: 180, yCm: 120 },
      { xCm: 180, yCm: 180 },
      { xCm: 300, yCm: 180 },
      { xCm: 300, yCm: 300 },
      { xCm: 0, yCm: 300 },
      { xCm: 0, yCm: 180 },
      { xCm: 120, yCm: 180 },
      { xCm: 120, yCm: 120 },
      { xCm: 0, yCm: 120 },
    ]
    const geometry: PlanGeometry = {
      ...entryRoom,
      widthCm: 300,
      heightCm: 300,
      walls: [
        {
          id: 'top',
          kind: 'outer',
          start: { xCm: 0, yCm: 0 },
          end: { xCm: 300, yCm: 0 },
        },
      ],
      openings: [
        {
          id: 'entry',
          type: 'door',
          wallId: 'top',
          offsetCm: 105,
          widthCm: 90,
          clearance: { side: 'left', depthCm: 90, shape: 'rectangle' },
        },
      ],
      rooms: [{ name: 'Гостиная', polygon }],
    }
    const input = roomLayoutInputFromGeometry(geometry, 'Гостиная', null)
    expect(input?.keepClearZones).toHaveLength(1)
    if (!input) return

    const layout = layoutRoom({ ...input, roomKind: 'living', roomName: 'Гостиная' }, [])

    expect(layout.walkwayCm).toBeLessThan(WALKWAY_CM)
    expect(layout.problems).toContainEqual({ kind: 'narrowWalkway', gapCm: layout.walkwayCm })
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('не размещает кровать и шкаф в вырезе, окне или зоне двери Г-образной спальни', () => {
    const input = roomLayoutInputFromGeometry(lShapedBedroom, 'Спальня', null)
    expect(input).not.toBeNull()
    if (!input) return
    const polygon = input.floorPolygon
    if (!polygon) throw new Error('Подтверждённый контур спальни не был передан в расстановку')

    const layout = layoutRoom({ ...input, roomKind: 'bedroom', roomName: 'Спальня' }, [
      {
        id: 'bed',
        title: 'Кровать 140',
        category: 'bed',
        dimensions: { width: 140, depth: 200, height: 90 },
        operationClearance: { side: 35 },
        quantity: 1,
      },
      {
        id: 'wardrobe',
        title: 'Шкаф',
        category: 'storage',
        subcategory: 'wardrobe',
        dimensions: { width: 120, depth: 55, height: 220 },
        operationClearance: { front: 45 },
        quantity: 1,
      },
    ])

    expect(input.floorReservations).toHaveLength(2)
    expect(input.keepClearZones).toHaveLength(1)
    expect(layout.problems).toEqual([])
    expect(layout.placed).toHaveLength(2)
    expect(layout.placed.every((place) => rectInsideFloor(place, polygon))).toBe(true)
    expect(
      layout.placed.every((place) =>
        input.floorReservations.every((opening) => !rectBlocksFloorReservation(place, opening)),
      ),
    ).toBe(true)
    expect(
      layout.placed.every((place) =>
        input.keepClearZones.every((zone) => !rectOverlapsPolygon(place, zone.polygon)),
      ),
    ).toBe(true)
  })

  it('отвергает закреплённый диван в зоне открывания входной двери', () => {
    const input = roomLayoutInputFromGeometry(entryRoom, 'Гостиная', null)
    expect(input?.keepClearZones).toHaveLength(1)
    if (!input) return

    const layout = layoutRoom({ ...input, roomKind: 'living', roomName: 'Гостиная' }, [
      {
        id: 'sofa',
        title: 'Диван у двери',
        category: 'sofa',
        dimensions: { width: 100, depth: 80, height: 80 },
        operationClearance: { front: 70 },
        placement: { xCm: 0, yCm: 280, rotation: 0 },
        quantity: 1,
      },
    ])

    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual(
      expect.objectContaining({ kind: 'invalidPlacement', reason: 'blocked' }),
    )
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('не выдаёт непомеренное окно за проверенное место для низкой мебели', () => {
    const geometry: PlanGeometry = {
      ...entryRoom,
      openings: [{ id: 'window', type: 'window', wallId: 'top', offsetCm: 100, widthCm: 120 }],
      walls: [
        ...entryRoom.walls,
        { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 300, yCm: 0 } },
      ],
    }
    const input = roomLayoutInputFromGeometry(geometry, 'Гостиная', null)
    expect(input?.missingSafetyData.join(' ')).toContain('высоту подоконника')
    if (!input) return

    const layout = layoutRoom({ ...input, roomKind: 'living', roomName: 'Гостиная' }, [
      {
        id: 'cabinet',
        title: 'Тумба под окном',
        category: 'storage',
        subcategory: 'cabinet',
        dimensions: { width: 120, depth: 40, height: 60 },
        operationClearance: { front: 45 },
        placement: { xCm: 100, yCm: 0, rotation: 0 },
        quantity: 1,
      },
    ])

    expect(layout.placed).toEqual([])
    expect(layout.safetySummary.status).not.toBe('checked')
  })
})

describe('сохранённые неподвижные зоны в расстановке', () => {
  const square: PlanGeometry = {
    ...entryRoom,
    widthCm: 400,
    heightCm: 400,
    openings: [],
    walls: [
      { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 } },
      { id: 'right', kind: 'outer', start: { xCm: 400, yCm: 0 }, end: { xCm: 400, yCm: 400 } },
      { id: 'bottom', kind: 'outer', start: { xCm: 400, yCm: 400 }, end: { xCm: 0, yCm: 400 } },
      { id: 'left', kind: 'outer', start: { xCm: 0, yCm: 400 }, end: { xCm: 0, yCm: 0 } },
    ],
    rooms: [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 400, yCm: 0 },
          { xCm: 400, yCm: 400 },
          { xCm: 0, yCm: 400 },
        ],
      },
    ],
  }
  const diamond: PlanGeometry = {
    ...square,
    rooms: [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 0, yCm: 200 },
          { xCm: 200, yCm: 0 },
          { xCm: 400, yCm: 200 },
          { xCm: 200, yCm: 400 },
        ],
      },
    ],
  }
  const strip = { xCm: 50, yCm: 0, widthCm: 20, depthCm: 400 }
  const kitchenItem = {
    id: 'cabinet',
    kind: 'cabinet' as const,
    xCm: 55,
    yCm: 180,
    widthCm: 40,
    depthCm: 40,
    front: 'right' as const,
    openingDepthCm: 20,
    passageCm: 30,
    installationGaps: { top: 0, right: 0, bottom: 0, left: 20 },
  }

  function tableLayout(geometry: PlanGeometry, xCm = 55, yCm = 180) {
    const input = roomLayoutInputFromGeometry(geometry, 'Гостиная', null)
    expect(input).not.toBeNull()
    if (!input) throw new Error('Контрольная комната не найдена')
    const layout = layoutRoom(input, [
      {
        id: 'table',
        title: 'Контрольный стол',
        category: 'table',
        dimensions: { width: 40, depth: 40, height: 75 },
        operationClearance: { around: 5 },
        quantity: 1,
        placement: { xCm, yCm, rotation: 0 },
      },
    ])
    return { input, layout }
  }

  it.each(['column', 'void'] as const)('не теряет %s при пересечении только рёбрами', (kind) => {
    const geometry: PlanGeometry =
      kind === 'column'
        ? { ...diamond, obstacles: [{ ...strip, id: 'column', kind: 'column' }] }
        : {
            ...diamond,
            voids: [
              {
                id: 'void',
                polygon: [
                  { xCm: 50, yCm: 0 },
                  { xCm: 70, yCm: 0 },
                  { xCm: 70, yCm: 400 },
                  { xCm: 50, yCm: 400 },
                ],
              },
            ],
          }
    const { input, layout } = tableLayout(geometry)
    expect(input.keepClearZones).toHaveLength(1)
    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual(expect.objectContaining({ reason: 'blocked' }))
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it.each([
    ['габарит', 55],
    ['открывание и проход', 100],
    ['монтажный габарит', 30],
  ] as const)('не размещает стол в кухонной зоне: %s', (_label, xCm) => {
    const { input, layout } = tableLayout({ ...square, kitchenItems: [kitchenItem] }, xCm)
    expect(input.keepClearZones).toHaveLength(3)
    expect(input.missingSafetyData).toEqual([])
    expect(layout.placed).toEqual([])
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('оставляет неизвестные кухонные эксплуатационные мерки запросом, а не нулём', () => {
    const { input, layout } = tableLayout(
      {
        ...square,
        kitchenItems: [
          {
            id: 'cabinet',
            kind: 'cabinet',
            xCm: 55,
            yCm: 180,
            widthCm: 40,
            depthCm: 40,
          },
        ],
      },
      250,
      180,
    )
    expect(input.keepClearZones).toHaveLength(1)
    expect(input.missingSafetyData).toHaveLength(2)
    expect(layout.placed).toHaveLength(1)
    expect(layout.safetySummary.status).toBe('needs-data')
  })

  it('не резервирует вырез Г-образной комнаты по одному габаритному прямоугольнику', () => {
    const geometry: PlanGeometry = {
      ...square,
      rooms: [
        {
          name: 'Гостиная',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 400, yCm: 0 },
            { xCm: 400, yCm: 100 },
            { xCm: 100, yCm: 100 },
            { xCm: 100, yCm: 400 },
            { xCm: 0, yCm: 400 },
          ],
        },
      ],
      kitchenItems: [{ ...kitchenItem, xCm: 250, yCm: 250 }],
    }
    const { input, layout } = tableLayout(geometry, 20, 180)
    expect(input.keepClearZones).toEqual([])
    expect(input.missingSafetyData).toEqual([])
    expect(layout.placed).toHaveLength(1)
  })

  it.each([undefined, 10])('учитывает измеренную толщину осевой стены вместо %s', (thicknessCm) => {
    const geometry: PlanGeometry = {
      ...square,
      walls: square.walls.map((wall) =>
        wall.id === 'top' ? { ...wall, measuredThicknessCm: 60, thicknessCm } : wall,
      ),
      rooms: [
        {
          name: 'Гостиная',
          polygon: [
            { xCm: 0, yCm: 30 },
            { xCm: 400, yCm: 30 },
            { xCm: 400, yCm: 400 },
            { xCm: 0, yCm: 400 },
          ],
        },
      ],
      openings: [
        {
          id: 'door',
          type: 'door',
          wallId: 'top',
          offsetCm: 100,
          widthCm: 90,
          clearance: { side: 'left', depthCm: 90, shape: 'swing', hinge: 'start' },
        },
      ],
    }
    const { input, layout } = tableLayout(geometry, 110, 5)
    expect(input.floorReservations).toHaveLength(1)
    expect(input.floorReservations[0]?.start).toEqual({ xCm: 100, yCm: 0 })
    expect(input.keepClearZones).toHaveLength(1)
    expect(layout.placed).toEqual([])
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('не превращает нативную PDF-грань в ось стены по введённой толщине', () => {
    const geometry: PlanGeometry = {
      ...square,
      pdfCalibration: {
        sourceSha256: 'source',
        pdfPage: 1,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
      },
      walls: square.walls.map((wall) =>
        wall.id === 'top' ? { ...wall, thicknessCm: 30, measuredThicknessCm: 30 } : wall,
      ),
      rooms: [
        {
          name: 'Гостиная',
          polygon: [
            { xCm: 0, yCm: 15 },
            { xCm: 400, yCm: 15 },
            { xCm: 400, yCm: 400 },
            { xCm: 0, yCm: 400 },
          ],
        },
      ],
      openings: [
        {
          id: 'door',
          type: 'door',
          wallId: 'top',
          offsetCm: 100,
          widthCm: 90,
          clearance: { side: 'left', depthCm: 90 },
        },
      ],
    }
    const { input, layout } = tableLayout(geometry, 250, 180)
    expect(input.floorReservations).toEqual([])
    expect(input.missingSafetyData.join(' ')).toContain('не совпадает с границей комнаты')
    expect(layout.safetySummary.status).toBe('needs-data')
  })

  it('переносит кухонный габарит и зазоры в локальные координаты комнаты', () => {
    const dx = 100
    const dy = 50
    const translated: PlanGeometry = {
      ...square,
      widthCm: 500,
      heightCm: 450,
      rooms: square.rooms.map((room) => ({
        ...room,
        polygon: room.polygon.map((point) => ({
          xCm: point.xCm + dx,
          yCm: point.yCm + dy,
        })),
      })),
      kitchenItems: [{ ...kitchenItem, xCm: kitchenItem.xCm + dx, yCm: kitchenItem.yCm + dy }],
    }
    const { input, layout } = tableLayout(translated)
    const original = tableLayout({ ...square, kitchenItems: [kitchenItem] })
    expect(input.keepClearZones).toEqual(original.input.keepClearZones)
    expect(layout.placed).toEqual([])
  })
})
