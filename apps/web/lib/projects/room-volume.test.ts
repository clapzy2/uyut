import { layoutRoom, type RoomLayout } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'
import { furnitureFaces, onPhysicalFloor, roomVolume } from './room-volume'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic fixture value')
  return value
}

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
  const signedLayout = (): RoomLayout => {
    const source = layout()
    const floor = [
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ]
    return {
      ...source,
      floorPolygon: floor,
      floorLevel: {
        referenceId: 'survey',
        referenceKind: 'finished-floor',
        zeroFloorId: 'inside',
        floorId: 'balcony',
        elevationCm: -15,
        surface: 'finished-floor',
        reviewKey: 'reviewed-context',
        origin: { xCm: 500, yCm: 600 },
        worldPolygon: floor.map((point) => ({ xCm: point.xCm + 500, yCm: point.yCm + 600 })),
        surfaces: [{ floor, voids: [] }],
      },
    }
  }
  it('uses the signed finished floor as furniture base without adding it twice', () => {
    const source = signedLayout()
    required(source.placementInputs[0]).heightCm = 80
    const model = roomVolume(source)
    expect(model?.floorSurfaces?.[0]?.elevationCm).toBe(-15)
    expect(model?.furniture?.every((item) => item.baseCm === -15)).toBe(true)
    const faces = furnitureFaces(model?.furniture?.slice(0, 1) ?? [])
    expect(Math.min(...faces.flatMap((face) => face.points.map((point) => point.zCm)))).toBe(-15)
    expect(Math.max(...faces.flatMap((face) => face.points.map((point) => point.zCm)))).toBe(65)
    expect(
      furnitureFaces(model?.furniture?.slice(2) ?? [])[0]?.points.every(
        (point) => point.zCm === -15,
      ),
    ).toBe(true)
  })
  it('adds entered decimal elevations without a binary arithmetic overshoot', () => {
    const source = signedLayout()
    required(source.floorLevel).elevationCm = -0.2
    required(source.placementInputs[0]).heightCm = 0.3
    const furniture = required(roomVolume(source)?.furniture)
    const faces = furnitureFaces(furniture.slice(0, 1))
    expect(Math.max(...faces.flatMap((face) => face.points.map((point) => point.zCm)))).toBe(0.1)
  })
  it('holds stale world shape and origin rather than matching only the bounding box', () => {
    const source = signedLayout()
    required(required(source.floorLevel).worldPolygon[1]).yCm += 1
    expect(roomVolume(source)).toBeNull()
    const moved = signedLayout()
    required(moved.floorLevel).origin.xCm += 1
    expect(roomVolume(moved)).toBeNull()
  })
  it('holds missing, falsy and unfinished supporting floor metadata', () => {
    for (const level of [
      null,
      false,
      {},
      { ...signedLayout().floorLevel, surface: 'existing-floor' },
    ]) {
      expect(
        roomVolume({ ...signedLayout(), floorLevel: level } as unknown as RoomLayout),
      ).toBeNull()
    }
  })
  it('does not put furniture over a shaft or an unmeasured region', () => {
    const source = signedLayout()
    required(required(source.floorLevel).surfaces[0]).voids = [
      [
        { xCm: 30, yCm: 40 },
        { xCm: 50, yCm: 40 },
        { xCm: 50, yCm: 60 },
        { xCm: 30, yCm: 60 },
      ],
    ]
    expect(roomVolume(source)).toBeNull()
    required(source.floorLevel).surfaces = [
      {
        floor: [
          { xCm: 0, yCm: 0 },
          { xCm: 400, yCm: 0 },
          { xCm: 400, yCm: 20 },
          { xCm: 0, yCm: 20 },
        ],
        voids: [],
      },
    ]
    expect(roomVolume(source)).toBeNull()
  })
  it('checks polygon interiors, not just vertices around a concave notch', () => {
    const notch = [
      { xCm: 0, yCm: 0 },
      { xCm: 100, yCm: 0 },
      { xCm: 100, yCm: 100 },
      { xCm: 60, yCm: 100 },
      { xCm: 60, yCm: 30 },
      { xCm: 40, yCm: 30 },
      { xCm: 40, yCm: 100 },
      { xCm: 0, yCm: 100 },
    ]
    const spanning = [
      { xCm: 20, yCm: 20 },
      { xCm: 80, yCm: 20 },
      { xCm: 80, yCm: 80 },
      { xCm: 20, yCm: 80 },
    ]
    expect(onPhysicalFloor(spanning, [{ floor: notch, voids: [] }])).toBe(false)
  })
  it('clips display margins to the supporting floor but never clips a required operation area', () => {
    const source = signedLayout()
    source.keepClearZones = [
      {
        kind: 'door',
        label: 'Door margin',
        polygon: [
          { xCm: -20, yCm: 0 },
          { xCm: 20, yCm: 0 },
          { xCm: 20, yCm: 20 },
          { xCm: -20, yCm: 20 },
        ],
      },
    ]
    const model = roomVolume(source)
    expect(model?.floorZones).toHaveLength(1)
    expect(model?.floorZones?.[0]?.floor.every((point) => point.xCm >= 0)).toBe(true)
    expect(model?.floorZones?.[0]?.baseCm).toBe(-15)
    source.functionalZones = [
      {
        itemId: 'chair',
        placementId: 'chair-1',
        title: 'Pull out',
        kind: 'front',
        direction: 'left',
        source: 'measured',
        clearanceCm: 20,
        xCm: -20,
        yCm: 0,
        widthCm: 40,
        depthCm: 20,
      },
    ]
    expect(roomVolume(source)).toBeNull()
  })
  it('не вращает размещённый габарит повторно и сохраняет высоту каждой копии товара', () => {
    const source = layout()
    const before = structuredClone(source)
    const model = roomVolume(source)
    expect(model?.furniture).toHaveLength(3)
    expect(model?.furniture?.[0]).toMatchObject({
      id: 'chair-1',
      itemId: 'chair',
      heightCm: 85,
      floor: [
        { xCm: 25, yCm: 30 },
        { xCm: 115, yCm: 30 },
        { xCm: 115, yCm: 230 },
        { xCm: 25, yCm: 230 },
      ],
    })
    expect(model?.furniture?.[1]?.heightCm).toBe(85)
    expect(model?.furniture?.map((item) => item.itemId)).toEqual(['chair', 'chair', 'table'])
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
    expect(faces.every((face) => face.furnitureId === first.id)).toBe(true)
    expect(Math.max(...faces.flatMap((face) => face.points.map((point) => point.zCm)))).toBe(85)
    const footprint = furnitureFaces([unknown])
    expect(footprint).toHaveLength(1)
    expect(footprint[0]?.footprintOnly).toBe(true)
    expect(footprint[0]?.furnitureId).toBe(unknown.id)
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
