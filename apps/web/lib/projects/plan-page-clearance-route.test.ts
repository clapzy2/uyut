import type { PlanPageContours } from '@uyut/db'
import type { MultiPolygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { inspectPlanPageClearanceRoutes } from './plan-page-clearance-route'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
const page = { pageWidth: 1000, pageHeight: 1000 }

function room(): PlanPageContours {
  return {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      {
        roomSourceNumber: 1,
        polygon: [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
          { x: 300, y: 300 },
          { x: 100, y: 300 },
        ],
        openings: [
          {
            id: 'left',
            kind: 'door',
            wallEdgeIndex: 3,
            start: { x: 100, y: 160 },
            end: { x: 100, y: 240 },
          },
          {
            id: 'right',
            kind: 'door',
            wallEdgeIndex: 1,
            start: { x: 300, y: 160 },
            end: { x: 300, y: 240 },
          },
        ],
      },
    ],
  }
}

describe('constructive square-clearance route', () => {
  it('checks the entry footprint in a room with one door', () => {
    const input = room()
    const firstRoom = input.rooms[0]
    if (!firstRoom?.openings) throw new Error('Missing room doors')
    firstRoom.openings.pop()
    expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
      status: 'entry-clearance',
      reachedDoorIds: ['left'],
      checkedNodes: 1,
    })
    const block: MultiPolygon = [
      [
        [
          [100, 160],
          [120, 160],
          [120, 240],
          [100, 240],
          [100, 160],
        ],
      ],
    ]
    expect(inspectPlanPageClearanceRoutes(input, block, page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'entry-footprint',
      reachedDoorIds: [],
    })
  })

  it('checks the width of the only door and distinguishes a room with no door', () => {
    const input = room()
    const firstRoom = input.rooms[0]
    const firstDoor = firstRoom?.openings?.[0]
    if (!firstRoom?.openings || !firstDoor) throw new Error('Missing room door')
    firstRoom.openings.pop()
    firstDoor.end.y = 210
    expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'door-too-narrow',
    })
    firstRoom.openings = []
    expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
      status: 'not-applicable',
    })
  })

  it.each(['shifted', 'outside-edge', 'wrong-edge', 'nonfinite'])(
    'rejects a %s door before checking a free square',
    (mutation) => {
      const input = room()
      const door = input.rooms[0]?.openings?.[0]
      if (!door) throw new Error('Missing door')
      if (mutation === 'shifted') {
        door.start.x = 120
        door.end.x = 120
      }
      if (mutation === 'outside-edge') {
        door.start.y = 80
        door.end.y = 160
      }
      if (mutation === 'wrong-edge') door.wallEdgeIndex = 1
      if (mutation === 'nonfinite') door.start.x = Number.NaN
      expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
        status: 'unresolved',
        reason: 'door-off-boundary',
        reachedDoorIds: [],
      })
    },
  )

  it('finds a 70 cm route and retains both reached door ids', () => {
    expect(inspectPlanPageClearanceRoutes(room(), [], page, 1, 70)[0]).toMatchObject({
      widthCm: 70,
      status: 'constructive-route',
      reachedDoorIds: ['left', 'right'],
    })
  })

  it('places the whole axis-aligned square inside a diagonal single-door entry', () => {
    const input = room()
    const firstRoom = input.rooms[0]
    if (!firstRoom) throw new Error('Missing room')
    firstRoom.polygon = [
      { x: 100, y: 300 },
      { x: 300, y: 100 },
      { x: 500, y: 300 },
      { x: 300, y: 500 },
    ]
    const door = {
      id: 'diagonal',
      kind: 'door' as const,
      wallEdgeIndex: 0,
      start: { x: 150, y: 250 },
      end: { x: 250, y: 150 },
    }
    firstRoom.openings = [door]
    expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
      status: 'entry-clearance',
      reachedDoorIds: ['diagonal'],
    })
    door.start = { x: 170, y: 230 }
    door.end = { x: 230, y: 170 }
    expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'door-too-narrow',
    })
  })

  it('never certifies a route through a full-height wall', () => {
    const wall: MultiPolygon = [
      [
        [
          [190, 100],
          [210, 100],
          [210, 300],
          [190, 300],
          [190, 100],
        ],
      ],
    ]
    expect(inspectPlanPageClearanceRoutes(room(), wall, page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'no-constructed-route',
      reachedDoorIds: ['left'],
    })
  })

  it('does not pass a doorway narrower than the requested clearance', () => {
    const input = room()
    const first = input.rooms[0]?.openings?.[0]
    if (!first) throw new Error('Missing door')
    first.end.y = 210
    expect(inspectPlanPageClearanceRoutes(input, [], page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'door-too-narrow',
    })
  })

  it('does not begin from a doorway blocked just inside the room', () => {
    const block: MultiPolygon = [
      [
        [
          [100, 160],
          [120, 160],
          [120, 240],
          [100, 240],
          [100, 160],
        ],
      ],
    ]
    expect(inspectPlanPageClearanceRoutes(room(), block, page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'entry-footprint',
    })
  })

  it('does not certify a gap narrower than the requested square footprint', () => {
    const wall: MultiPolygon = [
      [
        [
          [190, 160],
          [210, 160],
          [210, 300],
          [190, 300],
          [190, 160],
        ],
      ],
    ]
    expect(inspectPlanPageClearanceRoutes(room(), wall, page, 1, 70)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'no-constructed-route',
    })
  })

  it('can construct a route around an interior island when there is room', () => {
    const island: MultiPolygon = [
      [
        [
          [180, 180],
          [220, 180],
          [220, 220],
          [180, 220],
          [180, 180],
        ],
      ],
    ]
    expect(inspectPlanPageClearanceRoutes(room(), island, page, 1, 70)[0]).toMatchObject({
      status: 'constructive-route',
      reachedDoorIds: ['left', 'right'],
    })
  })
})
