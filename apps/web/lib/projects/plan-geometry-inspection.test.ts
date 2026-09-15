import type { PlanGeometry, PlanOpening } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { inspectPlanGeometry } from './plan-geometry-inspection'

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
