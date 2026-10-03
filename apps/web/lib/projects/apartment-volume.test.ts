import { layoutRoom, type RoomLayout } from '@uyut/catalog'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import openApartment from '../../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'
import { apartmentVolume } from './apartment-volume'
import { planVolume } from './plan-volume'

function rectangle(x: number, y: number, width: number, depth: number) {
  return [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
}

function geometry(): PlanGeometry {
  return {
    version: 1,
    status: 'confirmed',
    widthCm: 900,
    heightCm: 700,
    walls: [
      {
        id: 'top',
        kind: 'outer',
        start: { xCm: 0, yCm: 0 },
        end: { xCm: 900, yCm: 0 },
        heightCm: 270,
      },
    ],
    openings: [],
    rooms: [
      { name: 'Гостиная', polygon: rectangle(100, 200, 400, 300) },
      { name: 'Кухня', polygon: rectangle(520, 200, 300, 300) },
    ],
    footprint: rectangle(0, 0, 900, 700),
    warnings: [],
  }
}

function layout(width = 400): RoomLayout {
  return {
    ...layoutRoom({ widthCm: width, depthCm: 300 }, []),
    floorPolygon: rectangle(0, 0, width, 300),
    placed: [
      {
        id: 'chair-1',
        itemId: 'chair',
        title: 'Стул',
        xCm: 25,
        yCm: 30,
        widthCm: 60,
        depthCm: 100,
        wall: 'center',
      },
      {
        id: 'chair-2',
        itemId: 'chair',
        title: 'Стул',
        xCm: 130,
        yCm: 30,
        widthCm: 60,
        depthCm: 100,
        wall: 'center',
      },
      {
        id: 'table-1',
        itemId: 'table',
        title: 'Стол',
        xCm: 200,
        yCm: 180,
        widthCm: 90,
        depthCm: 60,
        wall: 'center',
      },
    ],
    placementInputs: [
      { id: 'chair', title: 'Стул', widthCm: 100, depthCm: 60, heightCm: 85, rotation: 90 },
      { id: 'table', title: 'Стол', widthCm: 90, depthCm: 60, rotation: 0 },
    ],
  }
}

describe('мебель комнат в общем объёме квартиры', () => {
  it('совместим с реальной 2D-расстановкой на независимом структурированном плане', () => {
    // Confirmation here enables a test path; it is not an on-site verification of the dataset.
    const source: PlanGeometry = {
      ...(openApartment.geometry as PlanGeometry),
      status: 'confirmed',
    }
    const room = source.rooms.find((candidate) => candidate.name === 'Гостиная')
    if (!room) throw new Error('Missing source living room')
    const current = layoutWithMeasurements(
      room.name,
      null,
      source,
      [
        {
          id: 'control-table',
          title: 'Контрольный стол',
          category: 'table',
          dimensions: { width: 80, depth: 60, height: 75 },
          quantity: 1,
        },
      ],
      'living',
    )
    if (!current) throw new Error('Missing generated room layout')
    expect(current.placed).toHaveLength(1)
    const before = structuredClone({ source, current })
    const result = apartmentVolume(source, [
      { roomId: 'swiss-living', roomName: room.name, layout: current },
    ])
    expect(result.notes).toEqual([])
    expect(result.model?.furniture).toHaveLength(1)
    const placed = current.placed[0]
    if (!placed) throw new Error('Missing generated placement')
    const originX = Math.min(...room.polygon.map((point) => point.xCm))
    const originY = Math.min(...room.polygon.map((point) => point.yCm))
    expect(result.model?.furniture?.[0]?.floor).toEqual(
      rectangle(originX + placed.xCm, originY + placed.yCm, placed.widthCm, placed.depthCm),
    )
    expect(result.model?.furniture?.[0]?.heightCm).toBe(75)
    expect(result.model?.floor).toEqual(source.footprint)
    expect({ source, current }).toEqual(before)
  })

  it('добавляет только исходный сдвиг, сохраняя поворот, копии и неизвестную высоту', () => {
    const source = geometry()
    const rooms = [
      { roomId: 'living', roomName: ' Гостиная ', layout: layout() },
      { roomId: 'kitchen', roomName: 'КУХНЯ', layout: layout(300) },
    ]
    const before = structuredClone({ source, rooms })
    const base = planVolume(source)
    const baseBefore = structuredClone(base)
    const result = apartmentVolume(source, rooms)
    expect(result.notes).toEqual([])
    expect(result.model?.furniture).toHaveLength(6)
    expect(result.model?.furniture?.[0]).toMatchObject({
      heightCm: 85,
      floor: rectangle(125, 230, 60, 100),
    })
    expect(result.model?.furniture?.[1]?.heightCm).toBe(85)
    expect(result.model?.furniture?.[2]?.heightCm).toBeUndefined()
    expect(result.model?.furniture?.[3]?.floor).toEqual(rectangle(545, 230, 60, 100))
    expect(new Set(result.model?.furniture?.map((item) => item.id)).size).toBe(6)
    expect(result.model?.walls).toEqual(base?.walls)
    expect(result.model?.floor).toEqual(base?.floor)
    expect({ source, rooms }).toEqual(before)
    expect(base).toEqual(baseBefore)
  })

  it('не растягивает мебель при масштабе, даже если различие меньше двух сантиметров', () => {
    const result = apartmentVolume(geometry(), [
      { roomId: 'living', roomName: 'Гостиная', layout: layout(400.01) },
      { roomId: 'kitchen', roomName: 'Кухня', layout: layout(300) },
    ])
    expect(result.model?.furniture).toHaveLength(3)
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]).toContain('масштаб')
    const moved = layout()
    moved.floorPolygon = moved.floorPolygon?.map((point) => ({ ...point, xCm: point.xCm + 0.01 }))
    expect(
      apartmentVolume(geometry(), [{ roomId: 'living', roomName: 'Гостиная', layout: moved }]).model
        ?.furniture,
    ).toEqual([])
  })

  it('переносит препятствия и рабочие зоны тем же сдвигом и сохраняет предварительный статус', () => {
    const current = layout()
    current.keepClearZones = [
      { kind: 'obstacle', label: 'Колонна', polygon: rectangle(20, 150, 30, 40) },
    ]
    current.functionalZones = [
      {
        itemId: 'chair',
        placementId: 'chair-1',
        title: 'Запас у стула',
        kind: 'front',
        direction: 'down',
        source: 'preliminary',
        clearanceCm: 70,
        xCm: 25,
        yCm: 130,
        widthCm: 60,
        depthCm: 70,
      },
    ]
    const rooms = [
      { roomId: 'living', roomName: 'Гостиная', layout: current },
      {
        roomId: 'kitchen',
        roomName: 'Кухня',
        layout: { ...current, widthCm: 300, floorPolygon: rectangle(0, 0, 300, 300) },
      },
    ]
    const before = structuredClone(rooms)
    const result = apartmentVolume(geometry(), rooms)
    const zones = result.model?.floorZones
    expect(zones).toHaveLength(4)
    expect(zones?.[0]).toMatchObject({
      kind: 'obstacle',
      title: 'Гостиная — Колонна',
      floor: rectangle(120, 350, 30, 40),
    })
    expect(zones?.[1]).toMatchObject({
      kind: 'operation',
      preliminary: true,
      floor: rectangle(125, 330, 60, 70),
    })
    expect(zones?.[2]?.floor).toEqual(rectangle(540, 350, 30, 40))
    expect(new Set(zones?.map((zone) => zone.id)).size).toBe(4)
    expect(rooms).toEqual(before)
  })

  it('не совмещает прямоугольник без исходного контура и неизвестную комнату', () => {
    const rectangular = layout()
    delete rectangular.floorPolygon
    const result = apartmentVolume(geometry(), [
      { roomId: 'living', roomName: 'Гостиная', layout: rectangular },
      { roomId: 'bedroom', roomName: 'Спальня', layout: layout() },
    ])
    expect(result.model?.furniture).toEqual([])
    expect(result.notes).toHaveLength(2)
    expect(result.notes[0]).toContain('без исходного контура')
    expect(result.notes[1]).toContain('нет комнаты')
  })

  it('сохраняет ступенчатую комнату и отклоняет другую форму с тем же габаритом', () => {
    const source = geometry()
    const floor = [
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 200 },
      { xCm: 200, yCm: 200 },
      { xCm: 200, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ]
    source.rooms[0] = {
      name: 'Гостиная',
      polygon: floor.map((point) => ({ xCm: point.xCm + 100, yCm: point.yCm + 200 })),
    }
    const room = { roomId: 'living', roomName: 'Гостиная', layout: layout() }
    expect(apartmentVolume(source, [room]).model?.furniture).toEqual([])
    expect(
      apartmentVolume(source, [{ ...room, layout: { ...room.layout, floorPolygon: floor } }]).model
        ?.furniture,
    ).toHaveLength(3)
  })

  it('отклоняет одинаковые названия с любой стороны, а не выбирает первую комнату', () => {
    const source = geometry()
    source.rooms.push({ name: 'ГОСТИНАЯ', polygon: rectangle(0, 0, 400, 300) })
    const room = { roomId: 'living', roomName: 'Гостиная', layout: layout() }
    expect(apartmentVolume(source, [room]).model?.furniture).toEqual([])
    const duplicateLayouts = apartmentVolume(geometry(), [room, { ...room, roomId: 'living-2' }])
    expect(duplicateLayouts.model?.furniture).toEqual([])
    expect(duplicateLayouts.notes).toHaveLength(2)
    expect(duplicateLayouts.notes.every((note) => note.includes('неоднозначны'))).toBe(true)
    expect(
      apartmentVolume(geometry(), [room, { ...room, roomName: 'Кухня', layout: layout(300) }]).model
        ?.furniture,
    ).toEqual([])
  })

  it('допускает только числовую погрешность, смену начала и направления того же контура', () => {
    const current = layout()
    const polygon = current.floorPolygon
    if (!polygon) throw new Error('Missing fixture floor')
    current.floorPolygon = [...polygon.slice(2), ...polygon.slice(0, 2)]
      .reverse()
      .map((point) => ({ ...point, xCm: point.xCm + 1e-8 }))
    expect(
      apartmentVolume(geometry(), [{ roomId: 'living', roomName: 'Гостиная', layout: current }])
        .model?.furniture,
    ).toHaveLength(3)
  })

  it('не переносит составные комнаты, повреждённую мебель и повторные размещения', () => {
    const source = geometry()
    source.rooms[0] = {
      name: 'Гостиная',
      sourceNumbers: [1, 2],
      polygon: rectangle(100, 200, 400, 300),
    }
    const room = { roomId: 'living', roomName: 'Гостиная', layout: layout() }
    expect(apartmentVolume(source, [room]).notes[0]).toContain('не подтверждён')
    const invalid = layout()
    invalid.placed = invalid.placed.map((item) => ({ ...item, xCm: Number.NaN }))
    expect(apartmentVolume(geometry(), [{ ...room, layout: invalid }]).model?.furniture).toEqual([])
    const duplicate = layout()
    duplicate.placed = duplicate.placed.map((item) => ({ ...item, id: 'same' }))
    expect(apartmentVolume(geometry(), [{ ...room, layout: duplicate }]).notes[0]).toContain(
      'идентификаторы',
    )
  })

  it('не строит квартиру из неподтверждённой геометрии', () => {
    const source = geometry()
    source.status = 'draft'
    const result = apartmentVolume(source, [])
    expect(result.model).toBeNull()
    expect(result.notes).toHaveLength(1)
  })
})
