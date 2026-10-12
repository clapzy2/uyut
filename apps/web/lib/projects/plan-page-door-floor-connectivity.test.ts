import type { PlanPageContours } from '@uyut/db'
import type { MultiPolygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { inspectPlanPageDoorFloorConnectivity } from './plan-page-door-floor-connectivity'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
const rect = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]

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
        polygon: rect(100, 100, 300, 300),
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

describe('door-to-door free-floor topology', () => {
  it.each(['decimal', 'rational'])(
    'refuses every room when %s source paint topology has not been classified',
    (precision) => {
      const input = room()
      const sourceRoom = input.rooms[0]
      if (!sourceRoom) throw new Error('Missing source room')
      const cleanRoom = structuredClone(sourceRoom)
      cleanRoom.roomSourceNumber = 2
      cleanRoom.polygon = cleanRoom.polygon.map(({ x, y }) => ({ x: x + 400, y }))
      cleanRoom.openings = cleanRoom.openings?.map((opening) => ({
        ...opening,
        start: { ...opening.start, x: opening.start.x + 400 },
        end: { ...opening.end, x: opening.end.x + 400 },
      }))
      input.rooms.push(cleanRoom)
      if (precision === 'rational') sourceRoom.polygon[0] = { x: 301 / 3, y: 100 }
      sourceRoom.sourceTopology = {
        kind: 'unclassified-source-paint',
        floorId: 'source-floor',
        exactPointKeys: [
          precision === 'rational' ? '301/3:100/1' : '100/1:100/1',
          '300/1:100/1',
          '300/1:300/1',
          '100/1:300/1',
        ],
        holes: [rect(180, 180, 220, 220)],
        holeExactPointKeys: [['180/1:180/1', '220/1:180/1', '220/1:220/1', '180/1:220/1']],
      }
      const before = structuredClone(input)
      const reports = inspectPlanPageDoorFloorConnectivity(input, [])
      expect(reports).toHaveLength(2)
      expect(reports.map((report) => report.contourKey)).toEqual(['1', '2'])
      for (const report of reports)
        expect(report).toMatchObject({
          status: 'unresolved',
          reason: 'unclassified-source-topology',
          freeComponentCount: 0,
          doors: [
            { openingId: 'left', freeComponents: [] },
            { openingId: 'right', freeComponents: [] },
          ],
        })
      expect(input).toEqual(before)
    },
  )
  it('connects two door centers through one free component', () => {
    expect(inspectPlanPageDoorFloorConnectivity(room(), [])[0]).toMatchObject({
      status: 'connected-centerline',
      freeComponentCount: 1,
      doors: [
        { openingId: 'left', freeComponents: [0] },
        { openingId: 'right', freeComponents: [0] },
      ],
    })
  })

  it('detects a painted barrier that separates the doors', () => {
    const barrier: MultiPolygon = [
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
    expect(inspectPlanPageDoorFloorConnectivity(room(), barrier)[0]).toMatchObject({
      status: 'disconnected',
      freeComponentCount: 2,
    })
  })

  it('leaves an obstructed doorway unresolved rather than attaching it to a wall', () => {
    const atDoor: MultiPolygon = [
      [
        [
          [100, 160],
          [110, 160],
          [110, 240],
          [100, 240],
          [100, 160],
        ],
      ],
    ]
    expect(inspectPlanPageDoorFloorConnectivity(room(), atDoor)[0]).toMatchObject({
      status: 'unresolved',
      doors: [
        { openingId: 'left', freeComponents: [] },
        { openingId: 'right', freeComponents: [0] },
      ],
    })
  })

  it('does not mistake an interior hole for a solid wall across the room', () => {
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
    expect(inspectPlanPageDoorFloorConnectivity(room(), island)[0]).toMatchObject({
      status: 'connected-centerline',
      freeComponentCount: 1,
    })
  })
})
