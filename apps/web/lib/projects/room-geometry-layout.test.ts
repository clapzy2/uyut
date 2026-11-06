import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import type { PlanGeometry } from '@uyut/db'
import { assert, describe, expect, it } from 'vitest'
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
    {
      id: 'window',
      type: 'window',
      wallId: 'top',
      offsetCm: 120,
      widthCm: 100,
      sillHeightCm: 85,
    },
    {
      id: 'door',
      type: 'door',
      wallId: 'left',
      offsetCm: 180,
      widthCm: 90,
      clearance: { side: 'right', depthCm: 90, shape: 'rectangle' },
    },
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

function neighbouringNativeDoors(
  ownX = 447.5,
  otherX = 461,
  from = 239.5,
  to = 329.5,
): PlanGeometry {
  const ownToLeft = ownX < otherX
  const rectangle = (left: number, right: number) => [
    { xCm: left, yCm: 0 },
    { xCm: right, yCm: 0 },
    { xCm: right, yCm: 400 },
    { xCm: left, yCm: 400 },
  ]
  return {
    ...geometry,
    widthCm: 1200,
    rooms: [
      { name: 'Гостиная', polygon: rectangle(ownToLeft ? 100 : ownX, ownToLeft ? ownX : 1100) },
      { name: 'Коридор', polygon: rectangle(ownToLeft ? otherX : 400, ownToLeft ? 610 : otherX) },
    ],
    walls: [
      { id: 'own', kind: 'inner', start: { xCm: ownX, yCm: 400 }, end: { xCm: ownX, yCm: 0 } },
      {
        id: 'other',
        kind: 'inner',
        start: { xCm: otherX, yCm: 0 },
        end: { xCm: otherX, yCm: 400 },
      },
    ],
    openings: [
      { id: 'own', wallId: 'own', type: 'door', offsetCm: 400 - to, widthCm: to - from },
      { id: 'other', wallId: 'other', type: 'door', offsetCm: from, widthCm: to - from },
    ],
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 2,
      sourceState: 'proposed',
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
    },
  }
}

describe('соседние нативные стороны проёмов', () => {
  it.each([
    [447.5, 461, 239.5, 329.5],
    [627.5, 614, 212, 302],
  ])('оставляет собственный проём при гранях x=%s и x=%s', (ownX, otherX, from, to) => {
    const source = neighbouringNativeDoors(ownX, otherX, from, to)
    const before = structuredClone(source)
    const result = roomLayoutInputFromGeometry(source, 'Гостиная', null)
    expect(result?.floorReservations).toHaveLength(1)
    expect(result?.floorReservations[0]?.start.xCm).toBe(ownX < otherX ? ownX - 100 : 0)
    expect(result?.floorReservations[0]?.start.yCm).toBe(to)
    expect(result?.floorReservations[0]?.end.yCm).toBe(from)
    expect(result?.missingSafetyData).toEqual(['Дверь 1: задайте свободную зону открывания.'])
    expect(source).toEqual(before)
  })

  it.each([
    'нет собственной стороны',
    'другой интервал',
    'другой тип',
    'известное открывание',
    'нет PDF',
    'неизвестный владелец',
    'неоднозначный владелец',
    'неоднозначная собственная сторона',
    'собственная дверь на дальней стене',
    'чужой отрезок пересекает выступ комнаты',
  ])('сохраняет предупреждение: %s', (reason) => {
    const source = neighbouringNativeDoors()
    const own = source.openings[0]
    const other = source.openings[1]
    const neighbour = source.rooms[1]
    assert(own && other && neighbour)
    if (reason === 'нет собственной стороны') source.openings = [other]
    if (reason === 'другой интервал') own.offsetCm += 5
    if (reason === 'другой тип') own.type = 'window'
    if (reason === 'известное открывание') other.clearance = { side: 'left', depthCm: 90 }
    if (reason === 'нет PDF') delete source.pdfCalibration
    if (reason === 'неизвестный владелец') source.rooms = source.rooms.slice(0, 1)
    if (reason === 'неоднозначный владелец')
      source.rooms.push({ ...neighbour, name: 'Другая комната' })
    if (reason === 'неоднозначная собственная сторона')
      source.openings.push({ ...own, id: 'duplicate' })
    if (reason === 'собственная дверь на дальней стене') {
      const wall = source.walls[0]
      assert(wall)
      wall.start.xCm = 100
      wall.end.xCm = 100
    }
    if (reason === 'чужой отрезок пересекает выступ комнаты') {
      const selected = source.rooms[0]
      assert(selected)
      selected.polygon = [
        { xCm: 100, yCm: 0 },
        { xCm: 447.5, yCm: 0 },
        { xCm: 447.5, yCm: 340 },
        { xCm: 480, yCm: 340 },
        { xCm: 480, yCm: 310 },
        { xCm: 455, yCm: 310 },
        { xCm: 455, yCm: 300 },
        { xCm: 480, yCm: 300 },
        { xCm: 480, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 100, yCm: 400 },
      ]
    }
    const result = roomLayoutInputFromGeometry(source, 'Гостиная', null)
    expect(result?.missingSafetyData.join(' ')).toContain('не совпадает с границей комнаты')
    const expectedX = reason === 'собственная дверь на дальней стене' ? 0 : 347.5
    expect(
      result?.floorReservations.every((reservation) => reservation.start.xCm === expectedX),
    ).toBe(true)
  })
})

describe('проёмы комнаты из 2D-схемы', () => {
  it('does not use a stale confirmed artifact while source reimport is required', () => {
    expect(
      roomLayoutInputFromGeometry(
        { ...geometry, requiresSourceReviewReimport: true },
        'Гостиная',
        null,
      ),
    ).toBeNull()
  })
  it('does not flatten explicit floor references into the local horizontal contract', () => {
    const legacy = roomLayoutInputFromGeometry(geometry, 'Гостиная', null)
    expect(legacy).not.toBeNull()
    expect(
      roomLayoutInputFromGeometry({ ...geometry, verticalReference: undefined }, 'Гостиная', null),
    ).toEqual(legacy)

    for (const reference of [null, false, 0, '', {}, { floors: [{ elevationCm: -15 }] }]) {
      const held = { ...geometry, verticalReference: reference } as unknown as PlanGeometry
      expect(roomLayoutInputFromGeometry(held, 'Гостиная', null)).toBeNull()
      expect(
        roomLayoutInputFromGeometry(held, 'Гостиная', { widthCm: 400, depthCm: 300 }),
      ).toBeNull()
    }
  })

  it('сохраняет дробные сантиметры в контуре и проёмах', () => {
    const result = roomLayoutInputFromGeometry(geometry, 'Гостиная', {
      widthCm: 400.5,
      depthCm: 300.25,
    })
    expect(result?.widthCm).toBe(400.5)
    expect(result?.depthCm).toBe(300.25)
    expect(result?.floorPolygon?.[1]?.xCm).toBe(400.5)
    expect(result?.reservations[0]?.fromCm).toBeCloseTo(120.15)
  })
  it('не угадывает контур среди одноимённых комнат', () => {
    expect(
      roomLayoutInputFromGeometry(
        { ...geometry, rooms: [...geometry.rooms, ...geometry.rooms] },
        'Гостиная',
        null,
      ),
    ).toBeNull()
  })
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
        {
          kind: 'window',
          wall: 'top',
          fromCm: 120,
          toCm: 220,
          clearanceCm: 0,
          sillHeightCm: 85,
        },
        { kind: 'door', wall: 'left', fromCm: 180, toCm: 270, clearanceCm: 0 },
      ],
      floorReservations: [
        {
          kind: 'window',
          start: { xCm: 120, yCm: 0 },
          end: { xCm: 220, yCm: 0 },
          clearanceCm: 0,
          sillHeightCm: 85,
        },
        {
          kind: 'door',
          start: { xCm: 0, yCm: 180 },
          end: { xCm: 0, yCm: 270 },
          clearanceCm: 0,
        },
      ],
      keepClearZones: [
        {
          kind: 'door',
          label: 'Дверь 2: свободная зона',
          polygon: [
            { xCm: 0, yCm: 180 },
            { xCm: 0, yCm: 270 },
            { xCm: 90, yCm: 270 },
            { xCm: 90, yCm: 180 },
          ],
        },
      ],
      missingSafetyData: [],
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
      missingSafetyData: [
        expect.stringContaining('Ширина комнаты'),
        expect.stringContaining('Глубина комнаты'),
      ],
    })
  })

  it('не объявляет небольшую разницу мерок конфликтом геометрии', () => {
    const result = roomLayoutInputFromGeometry(geometry, 'Гостиная', {
      widthCm: 401.5,
      depthCm: 301.5,
    })
    expect(result?.missingSafetyData).toEqual([])
  })

  it('не считает узкий дверной проём подтверждённым свободным проходом', () => {
    const narrowDoor: PlanGeometry = {
      ...geometry,
      openings: geometry.openings.map((opening) =>
        opening.id === 'door' ? { ...opening, widthCm: 60 } : opening,
      ),
    }
    const result = roomLayoutInputFromGeometry(narrowDoor, 'Гостиная', null)

    expect(result?.floorReservations.find((opening) => opening.kind === 'door')).toMatchObject({
      start: { xCm: 0, yCm: 180 },
      end: { xCm: 0, yCm: 240 },
    })
    expect(result?.missingSafetyData.join(' ')).toContain(
      `меньше принятого свободного прохода ${WALKWAY_CM} см`,
    )
    if (!result) return
    const layout = layoutRoom(result, [])
    expect(layout.safetySummary.status).toBe('blocked')
    expect(layout.walkwayCm).toBeLessThan(WALKWAY_CM)
    expect(roomLayoutInputFromGeometry(geometry, 'Гостиная', null)?.missingSafetyData).toEqual([])
  })

  it('не приписывает комнате проём на стене в 15 см от её контура', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top'
        ? { ...wall, start: { xCm: 100, yCm: 65 }, end: { xCm: 500, yCm: 65 } }
        : wall,
    )
    const result = roomLayoutInputFromGeometry({ ...geometry, walls }, 'Гостиная', null)
    expect(result?.floorReservations.some((entry) => entry.kind === 'window')).toBe(false)
    expect(result?.missingSafetyData.join(' ')).toContain('Окно 1 не совпадает')
  })

  it('проецирует проём с подтверждённой оси стены на грань пола без изменения ширины', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top'
        ? {
            ...wall,
            start: { xCm: 100, yCm: 60 },
            end: { xCm: 500, yCm: 60 },
            thicknessCm: 20,
          }
        : wall,
    )
    const result = roomLayoutInputFromGeometry({ ...geometry, walls }, 'Гостиная', null)

    expect(result?.floorReservations.find((opening) => opening.kind === 'window')).toMatchObject({
      start: { xCm: 120, yCm: 0 },
      end: { xCm: 220, yCm: 0 },
    })
    expect(result?.reservations.find((opening) => opening.kind === 'window')).toMatchObject({
      wall: 'top',
      fromCm: 120,
      toCm: 220,
    })
  })

  it('сдвигает подтверждённую зону двери вместе с гранью пола', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'left'
        ? {
            ...wall,
            start: { xCm: 110, yCm: 50 },
            end: { xCm: 110, yCm: 350 },
            thicknessCm: 20,
          }
        : wall,
    )
    const result = roomLayoutInputFromGeometry({ ...geometry, walls }, 'Гостиная', null)

    expect(result?.floorReservations.find((opening) => opening.kind === 'door')).toMatchObject({
      start: { xCm: 0, yCm: 180 },
      end: { xCm: 0, yCm: 270 },
    })
    expect(result?.keepClearZones.find((zone) => zone.kind === 'door')?.polygon).toEqual([
      { xCm: 0, yCm: 180 },
      { xCm: 0, yCm: 270 },
      { xCm: 90, yCm: 270 },
      { xCm: 90, yCm: 180 },
    ])
  })

  it('не приписывает проём комнате дальше половины толщины стены', () => {
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top'
        ? {
            ...wall,
            start: { xCm: 100, yCm: 65 },
            end: { xCm: 500, yCm: 65 },
            thicknessCm: 20,
          }
        : wall,
    )
    const result = roomLayoutInputFromGeometry({ ...geometry, walls }, 'Гостиная', null)

    expect(result?.floorReservations.some((opening) => opening.kind === 'window')).toBe(false)
    expect(result?.missingSafetyData.join(' ')).toContain('Окно 1 не совпадает')
  })

  it('выбирает грань у проёма, а не близкий короткий уступ той же комнаты', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 150, yCm: 50 },
          { xCm: 150, yCm: 51.5 },
          { xCm: 500, yCm: 51.5 },
          { xCm: 500, yCm: 350 },
          { xCm: 100, yCm: 350 },
        ],
      },
    ]
    const walls = geometry.walls.map((wall) =>
      wall.id === 'top'
        ? {
            ...wall,
            start: { xCm: 100, yCm: 61.5 },
            end: { xCm: 500, yCm: 61.5 },
            thicknessCm: 20,
          }
        : wall,
    )
    const result = roomLayoutInputFromGeometry({ ...geometry, rooms, walls }, 'Гостиная', null)

    expect(result?.floorReservations.find((opening) => opening.kind === 'window')).toMatchObject({
      start: { xCm: 120, yCm: 1.5 },
      end: { xCm: 220, yCm: 1.5 },
    })
  })

  it('не использует неподтверждённый план', () => {
    expect(
      roomLayoutInputFromGeometry({ ...geometry, status: 'draft' }, 'Гостиная', null),
    ).toBeNull()
  })

  it('не подставляет типовую глубину двери и переносит радиатор в точную зону', () => {
    const result = roomLayoutInputFromGeometry(
      {
        ...geometry,
        openings: geometry.openings.map((opening) =>
          opening.id === 'door' ? { ...opening, clearance: undefined } : opening,
        ),
        utilityPoints: [
          { id: 'radiator', kind: 'radiator', xCm: 300, yCm: 60, reachCm: 30 },
          { id: 'unknown-radius', kind: 'radiator', xCm: 450, yCm: 60 },
        ],
      },
      'Гостиная',
      null,
    )
    expect(result?.floorReservations.find((entry) => entry.kind === 'door')?.clearanceCm).toBe(0)
    expect(result?.keepClearZones).toHaveLength(1)
    expect(result?.keepClearZones[0]?.kind).toBe('radiator')
    expect(result?.missingSafetyData.join(' ')).toContain('Дверь 2')
    expect(result?.missingSafetyData.join(' ')).toContain('Радиатор unknown-radius')
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

  it('не теряет окно, пересекающее стык двух ровных участков контура', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 270, yCm: 50 },
          { xCm: 500, yCm: 50 },
          { xCm: 500, yCm: 350 },
          { xCm: 100, yCm: 350 },
        ],
      },
    ]
    const result = roomLayoutInputFromGeometry({ ...geometry, rooms }, 'Гостиная', null)

    expect(result?.floorReservations).toContainEqual(
      expect.objectContaining({
        kind: 'window',
        start: { xCm: 120, yCm: 0 },
        end: { xCm: 220, yCm: 0 },
      }),
    )
  })

  it('не склеивает два участка стены через настоящий вырез контура', () => {
    const rooms = [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 240, yCm: 50 },
          { xCm: 240, yCm: 70 },
          { xCm: 260, yCm: 70 },
          { xCm: 260, yCm: 50 },
          { xCm: 500, yCm: 50 },
          { xCm: 500, yCm: 350 },
          { xCm: 100, yCm: 350 },
        ],
      },
    ]
    const result = roomLayoutInputFromGeometry({ ...geometry, rooms }, 'Гостиная', null)

    expect(result?.floorReservations.some((opening) => opening.kind === 'window')).toBe(false)
    expect(result?.missingSafetyData.join(' ')).toContain('Окно 1 не совпадает')
  })

  it('просит высоту подоконника, если без неё нельзя проверить мебель', () => {
    const withoutSill = {
      ...geometry,
      openings: geometry.openings.map((opening) =>
        opening.type === 'window' ? { ...opening, sillHeightCm: undefined } : opening,
      ),
    }

    expect(roomLayoutInputFromGeometry(withoutSill, 'Гостиная', null)?.missingSafetyData).toContain(
      'Окно 1: укажите высоту подоконника, чтобы проверить низкую мебель под ним.',
    )
  })

  it('переносит колонны и шахты в запрещённые зоны конкретной комнаты', () => {
    const result = roomLayoutInputFromGeometry(
      {
        ...geometry,
        obstacles: [
          {
            id: 'manual_0123456789abcdef01234567',
            kind: 'column',
            xCm: 200,
            yCm: 100,
            widthCm: 30,
            depthCm: 40,
            label: 'Несущая колонна',
          },
          {
            id: 'manual_89abcdef0123456701234567',
            kind: 'shaft',
            xCm: 520,
            yCm: 100,
            widthCm: 40,
            depthCm: 40,
          },
        ],
      },
      'Гостиная',
      null,
    )

    expect(result?.keepClearZones.filter((zone) => zone.kind === 'obstacle')).toEqual([
      {
        kind: 'obstacle',
        label: 'Несущая колонна',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 130, yCm: 50 },
          { xCm: 130, yCm: 90 },
          { xCm: 100, yCm: 90 },
        ],
      },
    ])
  })
})

describe('кухонные модули в соседних комнатах', () => {
  const adjacentRooms: PlanGeometry = {
    ...geometry,
    walls: [],
    openings: [],
    rooms: [
      {
        name: 'Кухня',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 300, yCm: 0 },
          { xCm: 300, yCm: 300 },
          { xCm: 0, yCm: 300 },
        ],
      },
      {
        name: 'Спальня',
        polygon: [
          { xCm: 300, yCm: 0 },
          { xCm: 600, yCm: 0 },
          { xCm: 600, yCm: 300 },
          { xCm: 300, yCm: 300 },
        ],
      },
    ],
  }

  it('не относит модуль к соседней комнате при касании общей границы', () => {
    const plan: PlanGeometry = {
      ...adjacentRooms,
      kitchenItems: [
        { id: 'cabinet', kind: 'cabinet', xCm: 200, yCm: 100, widthCm: 100, depthCm: 60 },
      ],
    }

    const kitchen = roomLayoutInputFromGeometry(plan, 'Кухня', null)
    const bedroom = roomLayoutInputFromGeometry(plan, 'Спальня', null)

    expect(kitchen?.keepClearZones.map((zone) => zone.label)).toContain('Кухонный модуль 1')
    expect(kitchen?.missingSafetyData.join(' ')).toContain('Модуль 1')
    expect(bedroom?.keepClearZones).toEqual([])
    expect(bedroom?.missingSafetyData).toEqual([])
  })

  it('учитывает модуль в обеих комнатах при пересечении их площади', () => {
    const plan: PlanGeometry = {
      ...adjacentRooms,
      kitchenItems: [
        { id: 'cabinet', kind: 'cabinet', xCm: 250, yCm: 100, widthCm: 100, depthCm: 60 },
      ],
    }

    for (const roomName of ['Кухня', 'Спальня']) {
      const room = roomLayoutInputFromGeometry(plan, roomName, null)
      expect(room?.keepClearZones.map((zone) => zone.label)).toContain('Кухонный модуль 1')
      expect(room?.missingSafetyData.join(' ')).toContain('Модуль 1')
    }
  })

  it('не переносит в соседнюю комнату зону открывания, касающуюся её границы', () => {
    const plan: PlanGeometry = {
      ...adjacentRooms,
      kitchenItems: [
        {
          id: 'cabinet',
          kind: 'cabinet',
          xCm: 100,
          yCm: 100,
          widthCm: 100,
          depthCm: 60,
          front: 'right',
          openingDepthCm: 50,
          passageCm: 50,
        },
      ],
    }

    expect(roomLayoutInputFromGeometry(plan, 'Кухня', null)?.keepClearZones).toHaveLength(2)
    expect(roomLayoutInputFromGeometry(plan, 'Спальня', null)?.keepClearZones).toEqual([])
  })

  it('переносит зону открывания при реальном заходе в соседнюю комнату', () => {
    const plan: PlanGeometry = {
      ...adjacentRooms,
      kitchenItems: [
        {
          id: 'cabinet',
          kind: 'cabinet',
          xCm: 100,
          yCm: 100,
          widthCm: 100,
          depthCm: 60,
          front: 'right',
          openingDepthCm: 60,
          passageCm: 60,
        },
      ],
    }

    const bedroom = roomLayoutInputFromGeometry(plan, 'Спальня', null)
    expect(bedroom?.keepClearZones.map((zone) => zone.label)).toEqual([
      'Модуль 1: открывание и проход',
    ])
    expect(bedroom?.missingSafetyData).toEqual([])
  })

  it.each([
    { name: 'вложение', xCm: 100, yCm: 100, widthCm: 60, depthCm: 60 },
    { name: 'полное совпадение', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300 },
  ])('учитывает модуль при $name', ({ xCm, yCm, widthCm, depthCm }) => {
    const plan: PlanGeometry = {
      ...adjacentRooms,
      kitchenItems: [{ id: 'cabinet', kind: 'cabinet', xCm, yCm, widthCm, depthCm }],
    }

    expect(
      roomLayoutInputFromGeometry(plan, 'Кухня', null)?.keepClearZones.map((zone) => zone.label),
    ).toContain('Кухонный модуль 1')
    expect(roomLayoutInputFromGeometry(plan, 'Спальня', null)?.keepClearZones).toEqual([])
  })
})
