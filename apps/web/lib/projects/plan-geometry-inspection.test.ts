import type {
  PlanGeometry,
  PlanOpening,
  PlanOpeningFacePair,
  PlanPoint,
  PlanWallFacePair,
} from '@uyut/db'
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
  it('не теряет исходное доказательство связи граней после сохранения черновика', () => {
    const top = geometry.walls[0]
    const bottom = geometry.walls[2]
    if (!top || !bottom) throw new Error('В тесте нужны две грани стены')
    const face = (wall: typeof top) => ({
      wall,
      start: wall.start,
      end: wall.end,
      nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
    })
    const sourcePair: PlanWallFacePair = {
      faces: [face(top), face(bottom)],
      openings: [windowOpening],
    }
    const calibration: NonNullable<PlanGeometry['pdfCalibration']> = {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 6,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [1, 2],
      derivedOpeningIds: [],
      wallFacePairs: [],
      sourceWallFacePairs: [sourcePair],
      wallFaceRoomPolygons: geometry.rooms.map((room) => room.polygon),
    }
    expect(
      inspectManualPlanCompleteness({ ...geometry, pdfCalibration: calibration }).some(
        (issue) => issue.id === 'manual-pdf-wall-proof-lost',
      ),
    ).toBe(false)
    const changedGeometry = {
      ...geometry,
      walls: geometry.walls.map((wall) =>
        wall.id === 'top' ? { ...wall, end: { xCm: 490, yCm: 0 } } : wall,
      ),
    }
    const issues = inspectManualPlanCompleteness({
      ...changedGeometry,
      pdfCalibration: calibration,
    })
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manual-pdf-wall-proof-lost',
          severity: 'error',
          wallIds: ['top', 'bottom'],
        }),
      ]),
    )
    expect(
      inspectManualPlanCompleteness({
        ...changedGeometry,
        pdfCalibration: { ...calibration, sourceWallFacePairs: [sourcePair] },
      }),
    ).toEqual(issues)
  })

  it('помнит исходную связь сторон двери после промежуточного сохранения', () => {
    const top = geometry.walls[0]
    const bottom = geometry.walls[2]
    if (!top || !bottom) throw new Error('В тесте нужны две стены')
    const opposite: PlanOpening = { ...windowOpening, id: 'opposite', wallId: 'bottom' }
    const pair: PlanOpeningFacePair = {
      bindings: [
        { opening: windowOpening, wall: top },
        { opening: opposite, wall: bottom },
      ],
      jambs: [
        { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
        { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
      ],
    }
    const calibration: NonNullable<PlanGeometry['pdfCalibration']> = {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 6,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [1, 2],
      derivedOpeningIds: [],
      openingFacePairs: [],
      sourceOpeningFacePairs: [pair],
      wallFaceRoomPolygons: geometry.rooms.map((room) => room.polygon),
    }
    const unchanged = {
      ...geometry,
      openings: [windowOpening, opposite],
      pdfCalibration: calibration,
    }
    expect(
      inspectManualPlanCompleteness(unchanged).some(
        (issue) => issue.id === 'manual-pdf-door-proof-lost',
      ),
    ).toBe(false)
    const edited = {
      ...unchanged,
      openings: [{ ...windowOpening, widthCm: 130 }, opposite],
    }
    expect(inspectManualPlanCompleteness(edited)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manual-pdf-door-proof-lost',
          severity: 'error',
          openingIds: ['window', 'opposite'],
        }),
      ]),
    )
  })

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
  it('разделяет границу пола и стены, не отклоняя комнату на вогнутом краю', () => {
    const footprint = [
      { xCm: 0, yCm: 0 },
      { xCm: 500, yCm: 0 },
      { xCm: 500, yCm: 400 },
      { xCm: 300, yCm: 400 },
      { xCm: 300, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ]
    const room = {
      name: 'Комната',
      polygon: footprint,
    }
    const plan = {
      ...geometry,
      footprint,
      walls: geometry.walls.map((wall) => ({ ...wall, kind: 'inner' as const })),
      openings: [],
      rooms: [room],
    }

    expect(inspectManualPlanCompleteness(plan)).toEqual([])
    expect(
      inspectManualPlanCompleteness({
        ...plan,
        rooms: [
          {
            ...room,
            polygon: [
              { xCm: 0, yCm: 0 },
              { xCm: 500, yCm: 0 },
              { xCm: 500, yCm: 400 },
              { xCm: 0, yCm: 400 },
            ],
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-room-outside-outer-0', severity: 'error' }),
      ]),
    )
  })

  it('не принимает техническую пустоту поверх пола комнаты', () => {
    const voidShape = {
      id: 'shaft',
      polygon: [
        { xCm: 100, yCm: 100 },
        { xCm: 200, yCm: 100 },
        { xCm: 200, yCm: 200 },
        { xCm: 100, yCm: 200 },
      ],
    }
    expect(
      inspectManualPlanCompleteness({
        ...geometry,
        footprint: geometry.rooms[0]?.polygon,
        voids: [voidShape],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-void-overlap-shaft', severity: 'error' }),
      ]),
    )
  })

  it('проверяет площадь каждой комнаты, а не только сумму квартиры', () => {
    expect(inspectPlanRoomAreas(geometry.rooms, [{ name: 'Гостиная', areaM2: 18 }])).toEqual([
      expect.objectContaining({ id: 'manual-room-area-0', severity: 'error' }),
    ])
    expect(inspectPlanRoomAreas(geometry.rooms, [{ name: 'Гостиная', areaM2: 20 }])).toEqual([])
  })
  it('flags a PDF area discrepancy while allowing small source differences', () => {
    const room = {
      name: 'Помещение',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 808.4 },
        { xCm: 0, yCm: 808.4 },
      ],
    }
    expect(inspectPlanRoomAreas([room], [{ name: 'Помещение', areaM2: 40.13 }])).toEqual([])
    expect(
      inspectPlanRoomAreas([room], [{ name: 'Помещение', areaM2: 40.13 }], true),
    ).toContainEqual(
      expect.objectContaining({
        id: 'manual-room-area-0',
        severity: 'error',
        message: expect.stringContaining('40,42 м², на плане подписано 40,13 м²'),
      }),
    )
    expect(inspectPlanRoomAreas([room], [{ name: 'Помещение', areaM2: 40.36 }], true)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-room-area-0' })]),
    )
    expect(inspectPlanRoomAreas([room], [{ name: 'Помещение', areaM2: 40.38 }], true)).toEqual([])
    expect(inspectPlanRoomAreas([room], [{ name: 'Помещение', areaM2: 40.4 }], true)).toEqual([])

    const wardrobe = {
      name: 'Гардеробная',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 100, yCm: 0 },
        { xCm: 100, yCm: 152 },
        { xCm: 0, yCm: 152 },
      ],
    }
    expect(inspectPlanRoomAreas([wardrobe], [{ name: 'Гардеробная', areaM2: 1.5 }], true)).toEqual(
      [],
    )
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

  it('считает примыкающие тела стен связанными, даже если их оси не сходятся', () => {
    const first = {
      id: 'horizontal',
      kind: 'inner' as const,
      start: { xCm: 100, yCm: 100 },
      end: { xCm: 200, yCm: 100 },
      thicknessCm: 20,
    }
    const second = {
      id: 'vertical',
      kind: 'inner' as const,
      start: { xCm: 210, yCm: 100 },
      end: { xCm: 210, yCm: 200 },
      thicknessCm: 20,
    }
    for (const walls of [
      [first, second],
      [second, first],
    ]) {
      const issues = inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] })
      expect(issues).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
      )
    }
  })

  it('не соединяет стены через пустой зазор между телами', () => {
    const walls = [
      {
        id: 'horizontal',
        kind: 'inner' as const,
        start: { xCm: 100, yCm: 100 },
        end: { xCm: 200, yCm: 100 },
        thicknessCm: 20,
      },
      {
        id: 'vertical',
        kind: 'inner' as const,
        start: { xCm: 211, yCm: 111 },
        end: { xCm: 211, yCm: 200 },
        thicknessCm: 20,
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual-disconnected-walls', severity: 'error' }),
      ]),
    )
  })

  it('не скрывает продольный зазор двух обмеренных стен прежним допуском осей', () => {
    const walls = [
      {
        id: 'left',
        kind: 'inner' as const,
        start: { xCm: 100, yCm: 100 },
        end: { xCm: 200, yCm: 100 },
        thicknessCm: 20,
      },
      {
        id: 'right',
        kind: 'inner' as const,
        start: { xCm: 201, yCm: 100 },
        end: { xCm: 300, yCm: 100 },
        thicknessCm: 20,
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
    )
  })

  it('учитывает введённую толщину осевых стен при физическом примыкании', () => {
    const walls = [
      {
        id: 'horizontal',
        kind: 'inner' as const,
        start: { xCm: 100, yCm: 100 },
        end: { xCm: 200, yCm: 100 },
        measuredThicknessCm: 20,
      },
      {
        id: 'vertical',
        kind: 'inner' as const,
        start: { xCm: 210, yCm: 100 },
        end: { xCm: 210, yCm: 200 },
        measuredThicknessCm: 20,
      },
    ]
    for (const order of [walls, [...walls].reverse()]) {
      expect(
        inspectManualPlanCompleteness({ ...geometry, walls: order, openings: [], rooms: [] }),
      ).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
      )
    }
  })

  it('сохраняет продольный зазор после ввода толщины осевых стен', () => {
    const walls = [
      {
        id: 'left',
        kind: 'inner' as const,
        start: { xCm: 100, yCm: 100 },
        end: { xCm: 200, yCm: 100 },
        measuredThicknessCm: 20,
      },
      {
        id: 'right',
        kind: 'inner' as const,
        start: { xCm: 201, yCm: 100 },
        end: { xCm: 300, yCm: 100 },
        measuredThicknessCm: 20,
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
    )
  })

  it('использует введённую толщину вместо прежней распознанной при проверке стыка', () => {
    const walls = [
      {
        id: 'horizontal',
        kind: 'inner' as const,
        start: { xCm: 100, yCm: 100 },
        end: { xCm: 200, yCm: 100 },
        thicknessCm: 40,
        measuredThicknessCm: 10,
      },
      {
        id: 'vertical',
        kind: 'inner' as const,
        start: { xCm: 210, yCm: 100 },
        end: { xCm: 210, yCm: 200 },
        thicknessCm: 40,
        measuredThicknessCm: 10,
      },
    ]
    expect(inspectManualPlanCompleteness({ ...geometry, walls, openings: [], rooms: [] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
    )
  })

  it.each([
    ['measuredThicknessCm', false],
    ['thicknessCm', false],
    ['measuredThicknessCm', true],
    ['thicknessCm', true],
  ] as const)(
    'не превращает линии PDF в оси через поле %s (ручной ID: %s)',
    (thicknessField, manualId) => {
      const walls = [
        {
          id: manualId ? 'manual_000000000000000000000001' : 'horizontal-face',
          kind: 'inner' as const,
          start: { xCm: 100, yCm: 100 },
          end: { xCm: 200, yCm: 100 },
          [thicknessField]: 20,
        },
        {
          id: manualId ? 'manual_000000000000000000000002' : 'vertical-face',
          kind: 'inner' as const,
          start: { xCm: 210, yCm: 100 },
          end: { xCm: 210, yCm: 200 },
          [thicknessField]: 20,
        },
      ]
      const pdfCalibration: NonNullable<PlanGeometry['pdfCalibration']> = {
        sourceSha256: 'a'.repeat(64),
        pdfPage: 1,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [1],
        labelIndexes: [1, 2],
        derivedOpeningIds: [],
      }
      expect(
        inspectManualPlanCompleteness({
          ...geometry,
          walls,
          openings: [],
          rooms: [],
          pdfCalibration,
        }),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'manual-disconnected-walls' })]),
      )
    },
  )

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
