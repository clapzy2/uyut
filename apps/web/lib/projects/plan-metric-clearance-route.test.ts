import type { PlanGeometry } from '@uyut/db'
import { expect, it } from 'vitest'
import { inspectMetricClearanceRoutes } from './plan-metric-clearance-route'

const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { xCm: left, yCm: top },
  { xCm: right, yCm: top },
  { xCm: right, yCm: bottom },
  { xCm: left, yCm: bottom },
]
function fixture(): PlanGeometry {
  return {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm: 410,
    heightCm: 200,
    warnings: [],
    footprint: rectangle(0, 0, 410, 200),
    rooms: [
      { name: 'Коридор', polygon: rectangle(0, 0, 200, 200) },
      { name: 'Комната', polygon: rectangle(210, 0, 410, 200) },
    ],
    walls: [
      {
        id: 'top',
        kind: 'outer',
        start: { xCm: 0, yCm: 0 },
        end: { xCm: 410, yCm: 0 },
        thicknessCm: 10,
      },
      {
        id: 'middle',
        kind: 'inner',
        start: { xCm: 205, yCm: 0 },
        end: { xCm: 205, yCm: 200 },
        thicknessCm: 10,
      },
    ],
    openings: [
      {
        id: 'entry',
        type: 'door',
        wallId: 'top',
        offsetCm: 50,
        widthCm: 100,
        clearance: { side: 'left', depthCm: 100, shape: 'rectangle' },
      },
      { id: 'between', type: 'door', wallId: 'middle', offsetCm: 60, widthCm: 80 },
    ],
    routeWidthCm: 70,
    routeStartOpeningId: 'entry',
  }
}

it('passes the physical wall-axis model into continuous route search', () => {
  expect(inspectMetricClearanceRoutes(fixture()).result?.status).toBe('constructive-routes')
})

it('recalculates after a doorway edit instead of keeping the earlier route', () => {
  const geometry = fixture()
  expect(inspectMetricClearanceRoutes(geometry).result?.routes).toHaveLength(2)
  const door = geometry.openings.find((opening) => opening.id === 'between')
  if (!door) throw new Error('Missing fixture door')
  door.widthCm = 60
  expect(inspectMetricClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
})

it('includes edited fixed objects and kitchen modules in the same frame', () => {
  const geometry = fixture()
  geometry.kitchenItems = [
    { id: 'cabinet', kind: 'cabinet', xCm: 204, yCm: 0, widthCm: 2, depthCm: 200 },
  ]
  expect(inspectMetricClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
})

it('requires floor extent and measured wall thickness', () => {
  const geometry = fixture()
  geometry.footprint = undefined
  expect(inspectMetricClearanceRoutes(geometry).result).toBeUndefined()
  geometry.footprint = rectangle(0, 0, 410, 200)
  const wall = geometry.walls[0]
  if (!wall) throw new Error('Missing fixture wall')
  wall.thicknessCm = undefined
  expect(inspectMetricClearanceRoutes(geometry).missing).toContain('толщину')
})

it('does not interpret PDF wall faces as physical wall axes', () => {
  const geometry = fixture()
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
  }
  expect(inspectMetricClearanceRoutes(geometry).result).toBeUndefined()
})

it('does not silently discard a door whose host wall was removed', () => {
  const geometry = fixture()
  geometry.walls = geometry.walls.filter((wall) => wall.id !== 'middle')
  expect(inspectMetricClearanceRoutes(geometry).missing).toContain('привязку')
})
