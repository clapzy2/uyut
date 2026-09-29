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
