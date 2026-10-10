import polygonClipping, { type Polygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { inspectSourceClearanceRoutes } from './plan-source-clearance-route'

function box(left: number, top: number, right: number, bottom: number): Polygon {
  return [
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top],
    ],
  ]
}

function fixture(doorWidth = 80) {
  const first = box(0, 0, 200, 200)
  const second = box(210, 0, 410, 200)
  return {
    freeFloor: polygonClipping.union(
      first,
      second,
      box(199, 100 - doorWidth / 2, 211, 100 + doorWidth / 2),
    ),
    rooms: [first, second].map((floor, index) => ({
      id: String(index),
      polygon: (floor[0] ?? []).map(([xCm, yCm]) => ({ xCm, yCm })),
    })),
    start: { xCm: 100, yCm: 100 },
    widthCm: 70,
  }
}

function adjoiningRooms() {
  const floors = [box(0, 0, 200, 200), box(200, 0, 400, 200)] as const
  return {
    freeFloor: polygonClipping.union(...floors),
    rooms: floors.map((floor, index) => ({
      id: String(index),
      polygon: (floor[0] ?? []).map(([xCm, yCm]) => ({ xCm, yCm })),
    })),
    start: { xCm: 100, yCm: 100 },
    widthCm: 70,
  }
}

describe('continuous source clearance routes', () => {
  it('preserves the exact square result and omits rectangle metadata when no footprint is supplied', () => {
    const input = fixture()
    const legacy = inspectSourceClearanceRoutes(input)
    expect(inspectSourceClearanceRoutes({ ...input, footprintCm: undefined })).toEqual(legacy)
    expect(Object.hasOwn(legacy, 'footprintCm')).toBe(false)
    expect(legacy.footprint).toBe('axis-aligned-square')
  })
  it('uses independent body width and depth without finding a hidden rotated orientation', () => {
    const input = fixture(80)
    const horizontal = inspectSourceClearanceRoutes({
      ...input,
      footprintCm: { widthCm: 120, depthCm: 40 },
    })
    expect(horizontal.status).toBe('constructive-routes')
    expect(horizontal).toMatchObject({
      footprint: 'axis-aligned-rectangle',
      footprintCm: { widthCm: 120, depthCm: 40 },
    })
    expect(
      inspectSourceClearanceRoutes({ ...input, footprintCm: { widthCm: 40, depthCm: 120 } }).status,
    ).toBe('unresolved')
    const transposed = {
      ...input,
      freeFloor: input.freeFloor.map((polygon) =>
        polygon.map((ring) => ring.map(([x, y]) => [y, x] as [number, number])),
      ),
      rooms: input.rooms.map((room) => ({
        ...room,
        polygon: room.polygon.map(({ xCm, yCm }) => ({ xCm: yCm, yCm: xCm })),
      })),
      start: { xCm: input.start.yCm, yCm: input.start.xCm },
    }
    expect(
      inspectSourceClearanceRoutes({ ...transposed, footprintCm: { widthCm: 120, depthCm: 40 } })
        .status,
    ).toBe('unresolved')
    expect(
      inspectSourceClearanceRoutes({ ...transposed, footprintCm: { widthCm: 40, depthCm: 120 } })
        .status,
    ).toBe('constructive-routes')
  })
  it('checks the entire wider rectangle corner against fixed obstacles and interior voids', () => {
    const input = fixture()
    const footprintCm = { widthCm: 120, depthCm: 40 }
    const obstacles = [
      { id: 'corner', kind: 'fixed' as const, xCm: 159, yCm: 119, widthCm: 10, depthCm: 10 },
    ]
    expect(
      inspectSourceClearanceRoutes({ ...input, metricObstacles: { obstacles } }).reason,
    ).not.toBe('entry-footprint')
    expect(
      inspectSourceClearanceRoutes({ ...input, footprintCm, metricObstacles: { obstacles } })
        .reason,
    ).toBe('entry-footprint')
    expect(
      inspectSourceClearanceRoutes({
        ...input,
        footprintCm,
        metricObstacles: {
          voids: [
            {
              id: 'hole',
              polygon: [
                { xCm: 145, yCm: 90 },
                { xCm: 155, yCm: 90 },
                { xCm: 155, yCm: 100 },
                { xCm: 145, yCm: 100 },
              ],
            },
          ],
        },
      }).reason,
    ).toBe('entry-footprint')
  })
  it.each(['barrier', 'obstacle', 'void'] as const)(
    'checks a whole rectangular sweep across a thin %s between grid nodes',
    (mode) => {
      const input = { ...fixture(), footprintCm: { widthCm: 1, depthCm: 80 }, stepCm: 20 }
      const result = inspectSourceClearanceRoutes({
        ...input,
        ...(mode === 'barrier'
          ? { boundaryBarriers: [{ start: { xCm: 205, yCm: 0 }, end: { xCm: 205, yCm: 200 } }] }
          : {}),
        ...(mode === 'obstacle'
          ? {
              metricObstacles: {
                obstacles: [
                  {
                    id: 'thin',
                    kind: 'fixed' as const,
                    xCm: 205,
                    yCm: 0,
                    widthCm: 1,
                    depthCm: 200,
                  },
                ],
              },
            }
          : {}),
        ...(mode === 'void'
          ? {
              metricObstacles: {
                voids: [
                  {
                    id: 'shaft',
                    polygon: [
                      { xCm: 205, yCm: 0 },
                      { xCm: 206, yCm: 0 },
                      { xCm: 206, yCm: 200 },
                      { xCm: 205, yCm: 200 },
                    ],
                  },
                ],
              },
            }
          : {}),
      })
      expect(result.status).toBe('unresolved')
      expect(result.reason).toBe('no-constructed-route')
      expect(result.unresolvedRoomIds).toEqual(['1'])
    },
  )
  it('reports the bounded search limitation for a rectangle instead of claiming impassability', () => {
    const result = inspectSourceClearanceRoutes({
      ...fixture(),
      footprintCm: { widthCm: 120, depthCm: 40 },
      maxNodes: 1,
    })
    expect(result.reason).toBe('search-limit')
    expect(result.footprint).toBe('axis-aligned-rectangle')
  })
  it.each([
    null,
    false,
    [],
    {},
    { widthCm: 1 },
    { widthCm: 0, depthCm: 2 },
    { widthCm: 2, depthCm: -1 },
    { widthCm: NaN, depthCm: 2 },
    { widthCm: 2, depthCm: Infinity },
    { widthCm: '20', depthCm: 20 },
  ])('rejects invalid present rectangular footprints without square fallback %#', (footprintCm) => {
    expect(() =>
      inspectSourceClearanceRoutes({ ...fixture(), footprintCm } as unknown as Parameters<
        typeof inspectSourceClearanceRoutes
      >[0]),
    ).toThrow('прямоугольный габарит')
  })
  it('does not pass an uncut physical boundary between adjoining room polygons', () => {
    const input = adjoiningRooms()
    expect(inspectSourceClearanceRoutes(input).status).toBe('constructive-routes')
    const result = inspectSourceClearanceRoutes({
      ...input,
      boundaryBarriers: [{ start: { xCm: 200, yCm: 0 }, end: { xCm: 200, yCm: 200 } }],
    })
    expect(result.status).toBe('unresolved')
    expect(result.unresolvedRoomIds).toEqual(['1'])
  })

  it.each([
    [70, 'constructive-routes'],
    [80, 'constructive-routes'],
    [90, 'unresolved'],
  ] as const)(
    'checks a %i cm footprint through an 80 cm gap in a physical boundary',
    (widthCm, status) => {
      const result = inspectSourceClearanceRoutes({
        ...adjoiningRooms(),
        widthCm,
        boundaryBarriers: [
          { start: { xCm: 200, yCm: 0 }, end: { xCm: 200, yCm: 60 } },
          { start: { xCm: 200, yCm: 140 }, end: { xCm: 200, yCm: 200 } },
        ],
      })
      expect(result.status).toBe(status)
    },
  )

  it('rejects a zero-thickness boundary between grid nodes throughout the swept movement', () => {
    const result = inspectSourceClearanceRoutes({
      ...fixture(),
      widthCm: 1,
      stepCm: 20,
      boundaryBarriers: [{ start: { xCm: 205, yCm: 0 }, end: { xCm: 205, yCm: 200 } }],
    })
    expect(result.status).toBe('unresolved')
    expect(result.unresolvedRoomIds).toEqual(['1'])
  })

  it.each([
    [
      { xCm: 60, yCm: 60 },
      { xCm: 140, yCm: 140 },
    ],
    [
      { xCm: 100, yCm: 100 },
      { xCm: 180, yCm: 180 },
    ],
    [
      { xCm: 100, yCm: 100 },
      { xCm: 101, yCm: 101 },
    ],
  ])('rejects diagonal spans and endpoints inside the initial square', (start, end) => {
    const result = inspectSourceClearanceRoutes({
      ...adjoiningRooms(),
      boundaryBarriers: [{ start, end }],
    })
    expect(result.reason).toBe('entry-footprint')
    expect(result.checkedNodes).toBe(0)
  })

  it('does not move through a diagonal boundary crossing the floor', () => {
    const result = inspectSourceClearanceRoutes({
      ...adjoiningRooms(),
      widthCm: 20,
      rooms: [
        {
          id: 'across',
          polygon: [
            { xCm: 300, yCm: 100 },
            { xCm: 400, yCm: 100 },
            { xCm: 400, yCm: 200 },
            { xCm: 300, yCm: 200 },
          ],
        },
      ],
      boundaryBarriers: [{ start: { xCm: 150, yCm: 0 }, end: { xCm: 250, yCm: 200 } }],
    })
    expect(result.status).toBe('unresolved')
    expect(result.unresolvedRoomIds).toEqual(['across'])
  })

  it.each([
    [
      { xCm: 65, yCm: 65 },
      { xCm: 135, yCm: 65 },
    ],
    [
      { xCm: 65, yCm: 65 },
      { xCm: 65, yCm: 135 },
    ],
    [
      { xCm: 40, yCm: 90 },
      { xCm: 90, yCm: 40 },
    ],
    [
      { xCm: 65, yCm: 65 },
      { xCm: 40, yCm: 40 },
    ],
  ])('allows a span touching only the initial square boundary', (start, end) => {
    const result = inspectSourceClearanceRoutes({
      ...adjoiningRooms(),
      boundaryBarriers: [{ start, end }],
    })
    expect(result.status).toBe('constructive-routes')
  })

  it.each([
    [
      { xCm: 100, yCm: 100 },
      { xCm: 100, yCm: 100 },
    ],
    [
      { xCm: Number.NaN, yCm: 0 },
      { xCm: 200, yCm: 200 },
    ],
    [
      { xCm: 200, yCm: 0 },
      { xCm: Number.POSITIVE_INFINITY, yCm: 200 },
    ],
    [
      { xCm: 200, yCm: Number.NEGATIVE_INFINITY },
      { xCm: 200, yCm: 200 },
    ],
    [
      { xCm: 200, yCm: 0 },
      { xCm: 200, yCm: Number.NaN },
    ],
  ])('rejects invalid physical boundary segments', (start, end) => {
    expect(() =>
      inspectSourceClearanceRoutes({ ...fixture(), boundaryBarriers: [{ start, end }] }),
    ).toThrow('Некорректный отрезок')
  })

  it('subtracts fixed obstacles from the metric model before searching', () => {
    const result = inspectSourceClearanceRoutes({
      ...fixture(),
      metricObstacles: {
        obstacles: [{ id: 'fixed', kind: 'fixed', xCm: 204, yCm: 0, widthCm: 2, depthCm: 200 }],
      },
    })
    expect(result.status).toBe('unresolved')
    expect(result.unresolvedRoomIds).toEqual(['1'])
  })

  it('keeps a polygonal metric void instead of its enclosing rectangle', () => {
    const input = fixture()
    input.start = { xCm: 130, yCm: 130 }
    const result = inspectSourceClearanceRoutes({
      ...input,
      widthCm: 20,
      metricObstacles: {
        voids: [
          {
            id: 'void',
            polygon: [
              { xCm: 50, yCm: 50 },
              { xCm: 150, yCm: 50 },
              { xCm: 50, yCm: 150 },
            ],
          },
        ],
      },
    })
    expect(result.status).toBe('constructive-routes')
    const enclosingRectangle = inspectSourceClearanceRoutes({
      ...input,
      widthCm: 20,
      metricObstacles: {
        obstacles: [
          { id: 'enclosure', kind: 'shaft', xCm: 50, yCm: 50, widthCm: 100, depthCm: 100 },
        ],
      },
    })
    expect(enclosingRectangle.status).toBe('unresolved')
  })

  it('rejects invalid obstacle dimensions instead of ignoring them', () => {
    expect(() =>
      inspectSourceClearanceRoutes({
        ...fixture(),
        metricObstacles: {
          obstacles: [{ id: 'bad', kind: 'fixed', xCm: 0, yCm: 0, widthCm: -2, depthCm: 100 }],
        },
      }),
    ).toThrow('Некорректные размеры')
  })
  it('returns a complete path through an 80 cm doorway', () => {
    const result = inspectSourceClearanceRoutes(fixture())
    expect(result.status).toBe('constructive-routes')
    expect(result.routes).toHaveLength(2)
    expect(result.routes[1]?.points[0]).toEqual({ xCm: 100, yCm: 100 })
    expect(result.routes[1]?.points.at(-1)?.xCm).toBeGreaterThanOrEqual(245)
  })

  it('does not certify a 70 cm footprint through a 66 cm doorway', () => {
    const result = inspectSourceClearanceRoutes(fixture(66))
    expect(result.status).toBe('unresolved')
    expect(result.routes.map((route) => route.roomId)).toEqual(['0'])
  })

  it('checks the swept body against a thin obstruction between grid nodes', () => {
    const input = fixture()
    input.freeFloor = polygonClipping.difference(input.freeFloor, box(204, 0, 206, 200))
    const result = inspectSourceClearanceRoutes({ ...input, widthCm: 1, stepCm: 20 })
    expect(result.status).toBe('unresolved')
    expect(result.routes).toHaveLength(1)
  })

  it('preserves holes and finds a detour around an obstacle', () => {
    const input = fixture()
    input.freeFloor = polygonClipping.difference(input.freeFloor, box(140, 80, 160, 120))
    const result = inspectSourceClearanceRoutes({ ...input, widthCm: 20 })
    expect(result.status).toBe('constructive-routes')
    expect(result.routes[1]?.points.some((point) => point.yCm !== 100)).toBe(true)
  })

  it('does not start from an invalid entry footprint', () => {
    expect(inspectSourceClearanceRoutes({ ...fixture(), start: { xCm: 0, yCm: 0 } }).reason).toBe(
      'entry-footprint',
    )
  })

  it('reports a bounded search without claiming an impossible route', () => {
    expect(inspectSourceClearanceRoutes({ ...fixture(), maxNodes: 1 }).reason).toBe('search-limit')
  })

  it('keeps a returned detour entirely inside the free floor', () => {
    const input = fixture()
    input.freeFloor = polygonClipping.difference(input.freeFloor, box(140, 80, 160, 120))
    const result = inspectSourceClearanceRoutes({ ...input, widthCm: 20 })
    for (const route of result.routes) {
      for (let index = 1; index < route.points.length; index += 1) {
        const previous = route.points[index - 1]
        const current = route.points[index]
        if (!previous || !current) throw new Error('Missing route point')
        const swept = box(
          Math.min(previous.xCm, current.xCm) - 10,
          Math.min(previous.yCm, current.yCm) - 10,
          Math.max(previous.xCm, current.xCm) + 10,
          Math.max(previous.yCm, current.yCm) + 10,
        )
        expect(polygonClipping.difference(swept, input.freeFloor)).toEqual([])
      }
    }
  })
})
