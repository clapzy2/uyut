import type { PlanGeometry, PlanOpening, PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
  inspectPlanRoomAreas,
} from './plan-geometry-inspection'

const windowOpening: PlanOpening = {
  id: 'window',
  type: 'window',
  wallId: 'top',
  offsetCm: 100,
  widthCm: 120,
}

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 500,
  heightCm: 400,
  warnings: [],
  walls: [
    { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 500, yCm: 0 } },
    { id: 'right', kind: 'outer', start: { xCm: 500, yCm: 0 }, end: { xCm: 500, yCm: 400 } },
    { id: 'bottom', kind: 'outer', start: { xCm: 500, yCm: 400 }, end: { xCm: 0, yCm: 400 } },
    { id: 'left', kind: 'outer', start: { xCm: 0, yCm: 400 }, end: { xCm: 0, yCm: 0 } },
  ],
  openings: [windowOpening],
  rooms: [
    {
      name: 'Гостиная',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
  ],
}

describe('проверка правок 2D-схемы', () => {
  it('retains short native jamb edges and a door on its complete closure edge', () => {
    const walls = [
      {
        id: 'threshold',
        kind: 'inner' as const,
        start: { xCm: 0, yCm: 0 },
        end: { xCm: 90.3, yCm: 0 },
      },
      {
        id: 'reveal',
        kind: 'inner' as const,
        start: { xCm: 90.3, yCm: 0 },
        end: { xCm: 90.3, yCm: 7.5 },
      },
    ]
    expect(
      inspectPlanGeometry({
        ...geometry,
        walls,
        openings: [{ id: 'door', type: 'door', wallId: 'threshold', offsetCm: 0, widthCm: 90.3 }],
        rooms: [],
      }),
    ).toEqual([])
  })

  it('compares a shared physical zone with the sum of its two printed areas', () => {
    const room = {
      name: 'Прихожая / Коридор',
      sourceNumbers: [1, 5],
      polygon: geometry.rooms[0]?.polygon ?? [],
    }
    expect(
      inspectPlanRoomAreas(
        [room],
        [
          { name: 'Прихожая', sourceNumber: 1, areaM2: 8 },
          { name: 'Коридор', sourceNumber: 5, areaM2: 12 },
        ],
      ),
    ).toEqual([])
    expect(
      inspectPlanRoomAreas(
        [room],
        [
          { name: 'Прихожая', sourceNumber: 1, areaM2: 4 },
          { name: 'Коридор', sourceNumber: 5, areaM2: 6 },
        ],
      ),
    ).toHaveLength(1)
  })
  it('принимает связную схему', () => {
    expect(inspectPlanGeometry(geometry)).toEqual([])
  })

  it('показывает разрыв внешнего контура', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top' ? { ...wall, end: { xCm: 480, yCm: 0 } } : wall,
    )
    expect(inspectPlanGeometry({ ...geometry, walls })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'wall-gap-top', severity: 'warning' }),
      ]),
    )
  })

  it('не даёт сохранить проём за концом стены', () => {
    const openings = [{ ...windowOpening, offsetCm: 450 }]
    expect(inspectPlanGeometry({ ...geometry, openings })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'opening-bounds-window', severity: 'error' }),
      ]),
    )
  })

  it('находит пересекающиеся проёмы', () => {
    const openings = [
      windowOpening,
      { id: 'door', type: 'door' as const, wallId: 'top', offsetCm: 180, widthCm: 90 },
    ]
    expect(inspectPlanGeometry({ ...geometry, openings })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'opening-overlap-window-door',
          openingIds: ['window', 'door'],
        }),
      ]),
    )
  })

  it('находит самопересечение контура комнаты', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 500, yCm: 400 },
          { xCm: 500, yCm: 0 },
          { xCm: 0, yCm: 400 },
        ],
      },
    ]
    expect(inspectPlanGeometry({ ...geometry, rooms })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'room-cross-0', severity: 'error' })]),
    )
  })
})

describe('подтверждение ручной схемы', () => {
  it('проверяет площадь каждой комнаты, а не только сумму квартиры', () => {
    expect(inspectPlanRoomAreas(geometry.rooms, [{ name: 'Гостиная', areaM2: 18 }])).toEqual([
      expect.objectContaining({ id: 'manual-room-area-0', severity: 'error' }),
    ])
    expect(inspectPlanRoomAreas(geometry.rooms, [{ name: 'Гостиная', areaM2: 20 }])).toEqual([])
  })
  it('принимает замкнутую комнату', () => {
    expect(inspectManualPlanCompleteness(geometry)).toEqual([])
  })

  it('не подтверждает две комнаты с общей площадью пола', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 300, yCm: 0 },
          { xCm: 300, yCm: 400 },
          { xCm: 0, yCm: 400 },
        ],
      },
      {
        name: 'Спальня',
        polygon: [
          { xCm: 250, yCm: 0 },
          { xCm: 500, yCm: 0 },
          { xCm: 500, yCm: 400 },
          { xCm: 250, yCm: 400 },
        ],
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, rooms })).toContainEqual(
      expect.objectContaining({ id: 'manual-room-overlap-0-1', severity: 'error' }),
    )
    expect(inspectManualPlanCompleteness({ ...geometry, walls: [], rooms })).toContainEqual(
      expect.objectContaining({ id: 'manual-room-overlap-0-1', severity: 'error' }),
    )
    const firstRoom = rooms[0]
    const secondRoom = rooms[1]
    if (!firstRoom || !secondRoom) throw new Error('Missing test room')
    const adjoining = [
      firstRoom,
      {
        ...secondRoom,
        polygon: secondRoom.polygon.map((point) => ({
          ...point,
          xCm: point.xCm === 250 ? 300 : point.xCm,
        })),
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, rooms: adjoining })).not.toContainEqual(
      expect.objectContaining({ id: 'manual-room-overlap-0-1' }),
    )
  })

  it('не подтверждает комнату вне внешнего контура даже при связанных стенах', () => {
    const outer = [
      { xCm: 0, yCm: 0 },
      { xCm: 100, yCm: 0 },
      { xCm: 100, yCm: 100 },
      { xCm: 0, yCm: 100 },
    ]
    const polygon = [
      { xCm: 150, yCm: 150 },
      { xCm: 450, yCm: 150 },
      { xCm: 450, yCm: 550 },
      { xCm: 150, yCm: 550 },
    ]
    const plan: PlanGeometry = {
      ...geometry,
      widthCm: 600,
      heightCm: 650,
      openings: [],
      rooms: [{ name: 'Спальня', polygon }],
      walls: [
        ...outer.map((start, index) => ({
          id: `outer-${index}`,
          kind: 'outer' as const,
          start,
          end: outer[(index + 1) % outer.length] as PlanPoint,
        })),
        ...polygon.map((start, index) => ({
          id: `inner-${index}`,
          kind: 'inner' as const,
          start,
          end: polygon[(index + 1) % polygon.length] as PlanPoint,
        })),
        {
          id: 'bridge',
          kind: 'inner',
          start: { xCm: 100, yCm: 100 },
          end: { xCm: 150, yCm: 150 },
        },
      ],
    }
    // Draft validation is unchanged: containment is a separate confirmation gate.
    expect(inspectPlanGeometry(plan)).toEqual([])
    expect(inspectPlanRoomAreas(plan.rooms, [{ name: 'Спальня', areaM2: 12 }])).toEqual([])
    expect(inspectManualPlanCompleteness(plan)).toEqual([
      expect.objectContaining({ id: 'manual-room-outside-outer-0', severity: 'error' }),
    ])
  })

  it('принимает комнату внутри контура с неупорядоченными и развёрнутыми стенами', () => {
    const walls = [...geometry.walls]
      .reverse()
      .map((wall, index) =>
        index % 2 === 0 ? { ...wall, start: wall.end, end: wall.start } : wall,
      )
    const polygon = [
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 250 },
      { xCm: 0, yCm: 250 },
    ]
    expect(
      inspectManualPlanCompleteness({
        ...geometry,
        walls,
        rooms: [{ name: 'Спальня', polygon }],
      }),
    ).toEqual([])
  })

  it.each([
    {
      title: 'ребро пересекает стороны вогнутого выреза',
      room: [
        { xCm: 150, yCm: 150 },
        { xCm: 350, yCm: 150 },
        { xCm: 350, yCm: 400 },
        { xCm: 150, yCm: 400 },
      ],
    },
    {
      title: 'ребро проходит через вершины вогнутого выреза',
      room: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 500 },
        { xCm: 0, yCm: 500 },
      ],
    },
  ])('проверяет всё ребро комнаты, когда $title', ({ room }) => {
    const boundary = [
      { xCm: 0, yCm: 0 },
      { xCm: 500, yCm: 0 },
      { xCm: 500, yCm: 500 },
      { xCm: 300, yCm: 500 },
      { xCm: 300, yCm: 200 },
      { xCm: 200, yCm: 200 },
      { xCm: 200, yCm: 500 },
      { xCm: 0, yCm: 500 },
    ]
    const walls = boundary.map((start, index) => ({
      id: `outer-${index}`,
      kind: 'outer' as const,
      start,
      end: boundary[(index + 1) % boundary.length] as PlanPoint,
    }))
    expect(
      inspectManualPlanCompleteness({
        ...geometry,
        heightCm: 500,
        walls,
        openings: [],
        rooms: [{ name: 'Гостиная', polygon: room }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-room-outside-outer-0', severity: 'error' }),
      ]),
    )
  })

  it('разрешает совпадение границ комнаты и вогнутого внешнего контура', () => {
    const polygon = [
      { xCm: 0, yCm: 0 },
      { xCm: 500, yCm: 0 },
      { xCm: 500, yCm: 400 },
      { xCm: 300, yCm: 400 },
      { xCm: 300, yCm: 200 },
      { xCm: 0, yCm: 200 },
    ]
    const walls = polygon.map((start, index) => ({
      id: `outer-${index}`,
      kind: 'outer' as const,
      start,
      end: polygon[(index + 1) % polygon.length] as PlanPoint,
    }))
    expect(
      inspectManualPlanCompleteness({
        ...geometry,
        walls,
        openings: [],
        rooms: [{ name: 'Гостиная', polygon }],
      }),
    ).toEqual([])
  })

  it('находит стену, не связанную с контуром', () => {
    const walls = [
      ...geometry.walls,
      {
        id: 'island',
        kind: 'inner' as const,
        start: { xCm: 150, yCm: 150 },
        end: { xCm: 250, yCm: 150 },
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
    )
  })

  it.each(['first', 'last', 'reversed'] as const)(
    'highlights the disconnected island with %s wall order',
    (order) => {
      const island = {
        id: 'island',
        kind: 'inner' as const,
        start: { xCm: 150, yCm: 150 },
        end: { xCm: 250, yCm: 150 },
      }
      const walls = order === 'first' ? [island, ...geometry.walls] : [...geometry.walls, island]
      if (order === 'reversed') walls.reverse()
      const before = structuredClone(walls)
      const issue = inspectManualPlanCompleteness({ ...geometry, walls }).find(
        (value) => value.id === 'manual-disconnected-walls',
      )
      expect(issue).toMatchObject({ severity: 'error', wallIds: ['island'] })
      expect(walls).toEqual(before)
    },
  )

  it.each([false, true])(
    'anchors multiple exterior groups deterministically (reverse=%s)',
    (reverse) => {
      const walls = [
        {
          id: 'z-one',
          kind: 'outer' as const,
          start: { xCm: 0, yCm: 0 },
          end: { xCm: 100, yCm: 0 },
        },
        {
          id: 'z-two',
          kind: 'outer' as const,
          start: { xCm: 100, yCm: 0 },
          end: { xCm: 100, yCm: 100 },
        },
        {
          id: 'a-one',
          kind: 'outer' as const,
          start: { xCm: 200, yCm: 0 },
          end: { xCm: 300, yCm: 0 },
        },
        {
          id: 'a-two',
          kind: 'outer' as const,
          start: { xCm: 300, yCm: 0 },
          end: { xCm: 300, yCm: 100 },
        },
      ]
      if (reverse) walls.reverse()
      const issues = inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] })
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'manual-disconnected-walls',
            severity: 'error',
            wallIds: ['z-one', 'z-two'],
          }),
          expect.objectContaining({ id: 'manual-outer-disconnected', severity: 'error' }),
        ]),
      )

      walls.push({
        id: 'z-three',
        kind: 'outer',
        start: { xCm: 100, yCm: 100 },
        end: { xCm: 0, yCm: 100 },
      })
      expect(
        inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'manual-disconnected-walls',
            severity: 'error',
            wallIds: ['a-one', 'a-two'],
          }),
        ]),
      )
    },
  )

  it('uses the largest component when no exterior is marked, retaining the missing-exterior error', () => {
    const walls = [
      {
        id: 'island',
        kind: 'inner' as const,
        start: { xCm: 150, yCm: 150 },
        end: { xCm: 250, yCm: 150 },
      },
      ...geometry.walls.map((wall) => ({ ...wall, kind: 'inner' as const })),
    ]
    for (const order of [walls, [...walls].reverse()]) {
      expect(inspectManualPlanCompleteness({ ...geometry, walls: order })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'manual-disconnected-walls',
            severity: 'error',
            wallIds: ['island'],
          }),
          expect.objectContaining({ id: 'manual-missing-outer-walls', severity: 'error' }),
        ]),
      )
    }
  })

  it('не считает внутреннюю стену замыканием внешнего контура', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top' ? { ...wall, end: { xCm: 480, yCm: 0 } } : wall,
    )
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-outer-gap-top' })]),
    )
  })

  it('не принимает примыкание к середине внешней стены за замкнутый угол', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top' ? { ...wall, end: { xCm: 500, yCm: 200 } } : wall,
    )
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-outer-gap-top' })]),
    )
  })

  it('принимает стену, явно разбитую на два отрезка с общим концом', () => {
    const top = geometry.walls.find((wall) => wall.id === 'top')
    if (!top) throw new Error('В тестовом плане нет верхней стены')
    const walls = [
      { ...top, end: { xCm: 250, yCm: 0 } },
      {
        id: 'top-two',
        kind: 'outer' as const,
        start: { xCm: 250, yCm: 0 },
        end: { xCm: 500, yCm: 0 },
      },
      ...geometry.walls.slice(1),
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual([])
  })

  it('не подтверждает разветвление внешнего контура', () => {
    const walls = [
      ...geometry.walls,
      {
        id: 'spur',
        kind: 'outer' as const,
        start: { xCm: 0, yCm: 0 },
        end: { xCm: 100, yCm: 100 },
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-outer-branch-top' })]),
    )
  })

  it('не подтверждает самопересекающийся внешний контур', () => {
    const points: [PlanPoint, ...PlanPoint[]] = [
      { xCm: 0, yCm: 0 },
      { xCm: 500, yCm: 400 },
      { xCm: 0, yCm: 400 },
      { xCm: 500, yCm: 0 },
    ]
    const walls = points.map((start, index) => ({
      id: `cross-${index}`,
      kind: 'outer' as const,
      start,
      end: points[index + 1] ?? points[0],
    }))
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-outer-cross-cross-0-cross-2' }),
      ]),
    )
  })

  it('не подтверждает наложенные внешние стены', () => {
    const walls = [
      ...geometry.walls,
      {
        id: 'duplicate-top',
        kind: 'outer' as const,
        start: { xCm: 100, yCm: 0 },
        end: { xCm: 300, yCm: 0 },
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-outer-overlap-top-duplicate-top' }),
      ]),
    )
  })

  it('не принимает второй замкнутый внешний контур, соединённый только внутренней стеной', () => {
    const inner: [PlanPoint, ...PlanPoint[]] = [
      { xCm: 100, yCm: 100 },
      { xCm: 200, yCm: 100 },
      { xCm: 200, yCm: 200 },
      { xCm: 100, yCm: 200 },
    ]
    const secondLoop = inner.map((start, index) => ({
      id: `loop-${index}`,
      kind: 'outer' as const,
      start,
      end: inner[index + 1] ?? inner[0],
    }))
    const bridge = {
      id: 'bridge',
      kind: 'inner' as const,
      start: { xCm: 0, yCm: 0 },
      end: inner[0],
    }
    expect(
      inspectManualPlanCompleteness({
        ...geometry,
        walls: [...geometry.walls, bridge, ...secondLoop],
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-outer-disconnected' })]),
    )
  })

  it('находит комнату вдали от нанесённых стен', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 150, yCm: 150 },
          { xCm: 300, yCm: 150 },
          { xCm: 300, yCm: 250 },
          { xCm: 150, yCm: 250 },
        ],
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, rooms })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-detached-room-0' })]),
    )
  })
})
