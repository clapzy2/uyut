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

describe('continuous source clearance routes', () => {
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
