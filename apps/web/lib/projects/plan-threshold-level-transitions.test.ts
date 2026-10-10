import { inspectThresholdLevelTransitions } from '@uyut/catalog/plan-threshold-geometry'
import { applyPlanVerticalReference } from '@uyut/catalog/plan-vertical-reference'
import type { PlanGeometry, PlanOpeningFacePair, PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'

const box = (y: number): PlanPoint[] => [
  { xCm: 0, yCm: y },
  { xCm: 300, yCm: y },
  { xCm: 300, yCm: y + 200 },
  { xCm: 0, yCm: y + 200 },
]
function fixture(): PlanGeometry {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 300,
    heightCm: 420,
    footprint: [
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 420 },
      { xCm: 0, yCm: 420 },
    ],
    rooms: [
      { name: 'Гостиная', polygon: box(0) },
      { name: 'Балкон', spaceKind: 'balcony', polygon: box(220) },
    ],
    walls: [
      { id: 'inside', kind: 'inner', start: { xCm: 0, yCm: 200 }, end: { xCm: 300, yCm: 200 } },
      { id: 'outside', kind: 'inner', start: { xCm: 0, yCm: 220 }, end: { xCm: 300, yCm: 220 } },
    ],
    openings: [
      { id: 'a', type: 'balcony', wallId: 'inside', offsetCm: 100, widthCm: 90 },
      { id: 'b', type: 'balcony', wallId: 'outside', offsetCm: 100, widthCm: 90 },
    ],
    warnings: [],
  }
  const bindings = geometry.openings.map((opening, index) => ({
    opening: structuredClone(opening),
    wall: structuredClone(geometry.walls[index]),
    cut: [
      { xCm: 100, yCm: index ? 220 : 200 },
      { xCm: 190, yCm: index ? 220 : 200 },
    ] as [PlanPoint, PlanPoint],
  }))
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [1],
    labelIndexes: [],
    derivedOpeningIds: [],
    wallFaceRoomPolygons: geometry.rooms.map((room) => structuredClone(room.polygon)),
    openingFacePairs: [
      {
        bindings: bindings as PlanOpeningFacePair['bindings'],
        jambs: [
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
        ],
      },
    ],
  }
  const result = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'test-survey',
      kind: 'finished-floor',
      zeroFloorId: 'living',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: index ? 'balcony' : 'living',
        room,
        surface: 'finished-floor',
        elevationCm: index ? -15.2 : 0,
      })),
      wallBases: geometry.walls.map((wall, index) => ({
        wall,
        floorId: index ? 'balcony' : 'living',
      })),
      thresholds: [
        {
          id: 'threshold',
          elevationCm: 3.1,
          bindings: geometry.openings.map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
            opening: { id, type, wallId, offsetCm, widthCm },
            floorId: index ? 'balcony' : 'living',
          })),
        },
      ],
      source: { kind: 'site-measurement', reference: 'Synthetic level diagnostics only' },
    },
    'qa',
    '2026-10-11T09:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

describe('reviewed threshold elevation differences, not inferred stairs', () => {
  it('keeps exact independent rise measurements and does not manufacture structural step faces', () => {
    const geometry = fixture()
    const before = structuredClone(geometry)
    const report = inspectThresholdLevelTransitions(geometry)
    expect(report.transitions).toEqual([
      {
        id: 'threshold',
        floorNames: ['Гостиная', 'Балкон'],
        floorSurfaces: ['finished-floor', 'finished-floor'],
        floorElevationsCm: [0, -15.2],
        thresholdTopCm: 3.1,
        risesCm: [3.1, 18.3],
        deltaCm: -15.2,
        surfaceKnown: true,
      },
    ])
    expect(geometry).toEqual(before)
    expect('stairs' in report).toBe(false)
  })
  it('retains measured elevations but marks an unproved surface as unknown', () => {
    const geometry = fixture()
    const binding = geometry.pdfCalibration?.openingFacePairs?.[0]?.bindings[0]
    if (!binding) throw new Error('Missing synthetic cut')
    delete binding.cut
    expect(inspectThresholdLevelTransitions(geometry).transitions[0]).toMatchObject({
      risesCm: [3.1, 18.3],
      surfaceKnown: false,
    })
  })
  it('holds stale geometry and does not fall back to zero', () => {
    const geometry = fixture()
    const first = geometry.rooms[0]?.polygon[0]
    if (!first) throw new Error('Missing synthetic floor')
    first.xCm = 1
    expect(inspectThresholdLevelTransitions(geometry).transitions).toEqual([])
    expect(inspectThresholdLevelTransitions(geometry).issues.length).toBeGreaterThan(0)
  })
})
