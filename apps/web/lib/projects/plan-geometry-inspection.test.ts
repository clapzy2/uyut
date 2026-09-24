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
