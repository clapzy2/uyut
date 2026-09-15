import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 600,
  heightCm: 500,
  warnings: [],
  walls: [
    { id: 'top', kind: 'outer', start: { xCm: 100, yCm: 50 }, end: { xCm: 500, yCm: 50 } },
    { id: 'left', kind: 'inner', start: { xCm: 100, yCm: 50 }, end: { xCm: 100, yCm: 350 } },
  ],
  openings: [
    { id: 'window', type: 'window', wallId: 'top', offsetCm: 120, widthCm: 100 },
    { id: 'door', type: 'door', wallId: 'left', offsetCm: 180, widthCm: 90 },
  ],
  rooms: [
    {
      name: 'Гостиная',
      polygon: [
        { xCm: 100, yCm: 50 },
        { xCm: 500, yCm: 50 },
        { xCm: 500, yCm: 350 },
        { xCm: 100, yCm: 350 },
      ],
    },
  ],
}

describe('проёмы комнаты из 2D-схемы', () => {
  it('переводит глобальные координаты в стороны комнаты', () => {
    expect(roomLayoutInputFromGeometry(geometry, 'Гостиная', null)).toEqual({
      widthCm: 400,
      depthCm: 300,
      floorPolygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
      reservations: [
        { kind: 'window', wall: 'top', fromCm: 120, toCm: 220, clearanceCm: 0 },
        { kind: 'door', wall: 'left', fromCm: 180, toCm: 270, clearanceCm: 90 },
      ],
      floorReservations: [
        {
          kind: 'window',
          start: { xCm: 120, yCm: 0 },
          end: { xCm: 220, yCm: 0 },
          clearanceCm: 0,
        },
        {
          kind: 'door',
          start: { xCm: 0, yCm: 180 },
          end: { xCm: 0, yCm: 270 },
          clearanceCm: 90,
        },
      ],
    })
  })

  it('масштабирует проёмы к ручным обмерам комнаты', () => {
    expect(
      roomLayoutInputFromGeometry(geometry, 'Гостиная', { widthCm: 800, depthCm: 600 }),
    ).toMatchObject({
      widthCm: 800,
      depthCm: 600,
      reservations: [
        { wall: 'top', fromCm: 240, toCm: 440 },
        { wall: 'left', fromCm: 360, toCm: 540 },
      ],
    })
  })

  it('не использует неподтверждённый план', () => {
    expect(
      roomLayoutInputFromGeometry({ ...geometry, status: 'draft' }, 'Гостиная', null),
    ).toBeNull()
  })

  it('сохраняет точный контур Г-образной комнаты', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 500, yCm: 50 },
          { xCm: 500, yCm: 150 },
          { xCm: 200, yCm: 150 },
          { xCm: 200, yCm: 350 },
          { xCm: 100, yCm: 350 },
        ],
      },
    ]
    expect(roomLayoutInputFromGeometry({ ...geometry, rooms }, 'Гостиная', null)).toMatchObject({
      widthCm: 400,
      depthCm: 300,
      floorPolygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 100 },
        { xCm: 100, yCm: 100 },
        { xCm: 100, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
    })
  })

  it('переносит проём на внутреннюю стену Г-образной комнаты', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 500, yCm: 50 },
          { xCm: 500, yCm: 150 },
          { xCm: 200, yCm: 150 },
          { xCm: 200, yCm: 350 },
          { xCm: 100, yCm: 350 },
        ],
      },
    ]
    const walls = [
      ...geometry.walls,
      {
        id: 'notch',
        kind: 'inner' as const,
        start: { xCm: 500, yCm: 150 },
        end: { xCm: 200, yCm: 150 },
      },
    ]
    const openings = [
      { id: 'notch-window', type: 'window' as const, wallId: 'notch', offsetCm: 50, widthCm: 100 },
    ]

    expect(
      roomLayoutInputFromGeometry({ ...geometry, rooms, walls, openings }, 'Гостиная', null),
    ).toMatchObject({
      floorReservations: [
        {
          kind: 'window',
          start: { xCm: 350, yCm: 100 },
          end: { xCm: 250, yCm: 100 },
          clearanceCm: 0,
        },
      ],
      reservations: [],
    })
  })
})
