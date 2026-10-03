import { layoutRoom, type RoomLayout } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { furnitureFaces, roomVolume } from './room-volume'

function layout(): RoomLayout {
  return {
    ...layoutRoom({ widthCm: 400, depthCm: 300 }, []),
    placed: [
      {
        id: 'chair-1',
        itemId: 'chair',
        title: 'Стул',
        xCm: 25,
        yCm: 30,
        widthCm: 90,
        depthCm: 200,
        wall: 'left',
      },
      {
        id: 'chair-2',
        itemId: 'chair',
        title: 'Стул',
        xCm: 130,
        yCm: 30,
        widthCm: 90,
        depthCm: 200,
        wall: 'center',
      },
      {
        id: 'table-1',
        itemId: 'table',
        title: 'Стол',
        xCm: 250,
        yCm: 30,
        widthCm: 100,
        depthCm: 60,
        wall: 'center',
      },
    ],
    placementInputs: [
      { id: 'chair', title: 'Стул', widthCm: 200, depthCm: 90, heightCm: 85, rotation: 90 },
      { id: 'table', title: 'Стол', widthCm: 100, depthCm: 60, rotation: 0 },
    ],
  }
}

describe('перенос расстановки в объём', () => {
  it('не вращает размещённый габарит повторно и сохраняет высоту каждой копии товара', () => {
    const source = layout()
    const before = structuredClone(source)
    const model = roomVolume(source)
    expect(model?.furniture).toHaveLength(3)
    expect(model?.furniture?.[0]).toMatchObject({
      id: 'chair-1',
      heightCm: 85,
      floor: [
        { xCm: 25, yCm: 30 },
        { xCm: 115, yCm: 30 },
        { xCm: 115, yCm: 230 },
        { xCm: 25, yCm: 230 },
      ],
    })
    expect(model?.furniture?.[1]?.heightCm).toBe(85)
    expect(model?.furniture?.[2]?.heightCm).toBeUndefined()
    expect(source).toEqual(before)
  })
  it('сохраняет ступенчатый контур и не придумывает стены, высоты и проёмы', () => {
    const floor = [
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 100 },
      { xCm: 200, yCm: 100 },
      { xCm: 200, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ]
    const model = roomVolume({ ...layout(), floorPolygon: floor })
    expect(model?.floor).toEqual(floor)
    expect(model?.walls).toEqual([])
    expect(model?.openings).toEqual([])
    expect(roomVolume(layout())?.layoutNote).toContain('прямоугольным')
  })
  it('строит шесть ориентированных граней известного блока и только пол при неизвестной высоте', () => {
    const model = roomVolume(layout())
    const first = model?.furniture?.[0]
    const unknown = model?.furniture?.[2]
    if (!first || !unknown) throw new Error('Missing furniture')
    const faces = furnitureFaces([first])
    expect(faces).toHaveLength(6)
    expect(Math.max(...faces.flatMap((face) => face.points.map((point) => point.zCm)))).toBe(85)
    const footprint = furnitureFaces([unknown])
    expect(footprint).toHaveLength(1)
    expect(footprint[0]?.footprintOnly).toBe(true)
    expect(footprint[0]?.points.every((point) => point.zCm === 0)).toBe(true)
  })
  it('сохраняет только положения настоящих проёмов, не превращая радиатор в дверь', () => {
    const model = roomVolume({
      ...layout(),
      reservations: [
        { kind: 'window', wall: 'bottom', fromCm: 50, toCm: 150, clearanceCm: 0 },
        { kind: 'radiator', wall: 'top', fromCm: 100, toCm: 200, clearanceCm: 40 },
      ],
    })
    expect(model?.openings).toHaveLength(1)
    expect(model?.openings[0]).toMatchObject({
      type: 'window',
      cut: false,
      start: { xCm: 50, yCm: 300 },
      end: { xCm: 150, yCm: 300 },
    })
    const exact = roomVolume({
      ...layout(),
      floorReservations: [
        { kind: 'door', start: { xCm: 0, yCm: 50 }, end: { xCm: 0, yCm: 140 }, clearanceCm: 90 },
        {
          kind: 'ventilation',
          start: { xCm: 200, yCm: 0 },
          end: { xCm: 250, yCm: 0 },
          clearanceCm: 10,
        },
      ],
    })
    expect(exact?.openings).toHaveLength(1)
  })
  it('отклоняет нечисловые контуры и оставляет некорректную высоту неизвестной', () => {
    expect(roomVolume({ ...layout(), widthCm: Number.NaN })).toBeNull()
    expect(roomVolume({ ...layout(), floorPolygon: [] })).toBeNull()
    expect(
      roomVolume({
        ...layout(),
        placed: layout().placed.map((item) => ({ ...item, xCm: Number.NaN })),
      }),
    ).toBeNull()
    const model = roomVolume({
      ...layout(),
      placementInputs: layout().placementInputs.map((item) => ({
        ...item,
        heightCm: Number.POSITIVE_INFINITY,
      })),
    })
    expect(model?.furniture?.every((item) => item.heightCm === undefined)).toBe(true)
  })
  it('не переносит неразмещённые товары и не выдумывает объём при нулевой высоте', () => {
    const source = layout()
    const model = roomVolume({
      ...source,
      placed: source.placed.slice(0, 1),
      placementInputs: source.placementInputs.map((item) => ({ ...item, heightCm: 0 })),
    })
    expect(model?.furniture).toHaveLength(1)
    expect(model?.furniture?.[0]?.heightCm).toBeUndefined()
    expect(furnitureFaces(model?.furniture ?? [])).toHaveLength(1)
  })
  it('переносит препятствия и рабочие запасы без изменения координат и высот', () => {
    const source: RoomLayout = {
      ...layout(),
      keepClearZones: [
        {
          kind: 'obstacle',
          label: 'Технический короб',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 40, yCm: 0 },
            { xCm: 40, yCm: 60 },
            { xCm: 0, yCm: 60 },
          ],
        },
        {
          kind: 'door',
          label: 'Открывание двери',
          polygon: [
            { xCm: 0, yCm: 100 },
            { xCm: 90, yCm: 100 },
            { xCm: 0, yCm: 190 },
          ],
        },
      ],
      functionalZones: [
        {
          itemId: 'table',
          placementId: 'table-1',
          title: 'Стол',
          kind: 'front',
          direction: 'down',
          source: 'preliminary',
          clearanceCm: 60,
          xCm: 250,
          yCm: 90,
          widthCm: 100,
          depthCm: 60,
        },
      ],
    }
    const before = structuredClone(source)
    const zones = roomVolume(source)?.floorZones
    expect(zones).toHaveLength(3)
    expect(zones?.[0]?.floor).toEqual(source.keepClearZones[0]?.polygon)
    expect(zones?.[1]?.floor).toEqual(source.keepClearZones[1]?.polygon)
    expect(zones?.[2]).toMatchObject({
      kind: 'operation',
      preliminary: true,
      floor: [
        { xCm: 250, yCm: 90 },
        { xCm: 350, yCm: 90 },
        { xCm: 350, yCm: 150 },
        { xCm: 250, yCm: 150 },
      ],
    })
    expect(zones?.[0]).not.toHaveProperty('heightCm')
    if (zones?.[0]?.floor[0]) zones[0].floor[0].xCm = 99
    expect(source).toEqual(before)
  })
  it('не передаёт нечисловые зоны в SVG', () => {
    const source: RoomLayout = {
      ...layout(),
      keepClearZones: [
        { kind: 'radiator', label: 'Радиатор', polygon: [] },
        {
          kind: 'obstacle',
          label: 'Короб',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: Number.NaN, yCm: 0 },
            { xCm: 40, yCm: 40 },
          ],
        },
      ],
    }
    expect(roomVolume(source)?.floorZones).toEqual([])
  })
})
