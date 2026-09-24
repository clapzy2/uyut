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
