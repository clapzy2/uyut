import { validatePlanGeometryEdit } from '@uyut/ai'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { apartmentVolume } from './apartment-volume'
import { planEditRevision } from './plan-edit-revision'
import { inspectMetricClearanceRoutes } from './plan-metric-clearance-route'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'
import {
  applyPlanVerticalDimensions,
  inspectPlanVerticalDimensions,
} from './plan-vertical-dimensions'
import { applyPlanVerticalReference, referenceTransferIssue } from './plan-vertical-reference'
import { planVolume } from './plan-volume'

// Synthetic measured surfaces, not readings inferred from the user's apartment.
function reviewedFixture(firstLevel = 0, secondLevel = -15, firstBottom = 2, secondBottom = 17) {
  const box = (left: number, right: number): PlanPoint[] => [
    { xCm: left, yCm: 0 },
    { xCm: right, yCm: 0 },
    { xCm: right, yCm: 200 },
    { xCm: left, yCm: 200 },
  ]
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 410,
    heightCm: 200,
    warnings: [],
    footprint: box(0, 410),
    rooms: [
      { name: 'Room', polygon: box(0, 200), sourceNumber: 1 },
      { name: 'Balcony', polygon: box(210, 410), spaceKind: 'balcony', sourceNumber: 2 },
    ],
    walls: [
      {
        id: 'a',
        kind: 'inner',
        start: { xCm: 200, yCm: 0 },
        end: { xCm: 200, yCm: 200 },
        heightCm: 270,
      },
      {
        id: 'b',
        kind: 'inner',
        start: { xCm: 210, yCm: 0 },
        end: { xCm: 210, yCm: 200 },
        heightCm: 270,
      },
    ],
    openings: [
      {
        id: 'a-door',
        type: 'balcony',
        wallId: 'a',
        offsetCm: 60,
        widthCm: 80,
        bottomCm: firstBottom,
        heightCm: 210,
      },
      {
        id: 'b-door',
        type: 'balcony',
        wallId: 'b',
        offsetCm: 60,
        widthCm: 80,
        bottomCm: secondBottom,
        heightCm: 210,
      },
    ],
  }
  const [firstWall, secondWall] = geometry.walls
  const [firstOpening, secondOpening] = geometry.openings
  const [firstRoom, secondRoom] = geometry.rooms
  if (!firstWall || !secondWall || !firstOpening || !secondOpening || !firstRoom || !secondRoom)
    throw new Error('Missing synthetic inventory')
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    exteriorBoundaryRole: 'floor',
    anchorRoomNumbers: [1, 2],
    labelIndexes: [],
    derivedOpeningIds: [],
    wallFaceRoomPolygons: structuredClone(geometry.rooms.map(({ polygon }) => polygon)),
    wallFacePairs: [],
    openingFacePairs: [
      {
        bindings: structuredClone([
          { wall: firstWall, opening: firstOpening },
          { wall: secondWall, opening: secondOpening },
        ]),
        jambs: [
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
        ],
      },
    ],
  }
  const snapshot = ({ heightCm: _height, ...wall }: typeof firstWall) => wall
  const request = {
    version: 1,
    id: 'datum',
    kind: 'finished-floor',
    zeroFloorId: 'room-floor',
    acknowledged: true,
    floors: [
      { id: 'room-floor', room: firstRoom, surface: 'finished-floor', elevationCm: firstLevel },
      {
        id: 'balcony-floor',
        room: secondRoom,
        surface: 'finished-floor',
        elevationCm: secondLevel,
      },
    ],
    ceilings: [{ id: 'ceiling', floorId: 'room-floor', elevationCm: 266.3 }],
    wallBases: [
      { wall: snapshot(firstWall), floorId: 'room-floor' },
      { wall: snapshot(secondWall), floorId: 'balcony-floor' },
    ],
    thresholds: [],
    source: { kind: 'site-measurement', reference: 'Synthetic test only' },
  }
  const result = applyPlanVerticalReference(geometry, request, 'owner', '2026-10-10T00:00:00.000Z')
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

describe('common datum integration without legacy flat transfer', () => {
  it('compares 2 and 17 cm local bottoms as the same +2 cm aperture on floors 0 and -15', () => {
    const geometry = reviewedFixture()
    expect(inspectPlanVerticalDimensions(geometry)).toEqual([])
    expect(applyPlanVerticalDimensions(geometry, geometry).ok).toBe(true)
    expect(geometry.openings.map(({ bottomCm }) => bottomCm)).toEqual([2, 17])
    expect(geometry.walls.map(({ heightCm }) => heightCm)).toEqual([270, 270])
    const { verticalReference: _reference, ...legacy } = geometry
    expect(inspectPlanVerticalDimensions(legacy)[0]?.id).toContain('opening-paired-height')
  })

  it('compares decimals exactly without IEEE addition noise or a physical tolerance', () => {
    const geometry = reviewedFixture(0, -0.2, 0.1, 0.3)
    expect(inspectPlanVerticalDimensions(geometry)).toEqual([])
    const opposite = geometry.openings[1]
    if (!opposite) throw new Error('Missing opposite')
    opposite.bottomCm = 0.300000001
    expect(inspectPlanVerticalDimensions(geometry)[0]?.message).toContain('общем высотном отсчёте')
    opposite.bottomCm = Number.NaN
    expect(() => inspectPlanVerticalDimensions(geometry)).not.toThrow()
    expect(inspectPlanVerticalDimensions(geometry).length).toBeGreaterThan(0)
  })

  it('does not use an existing-floor surface as the finished-floor bottom origin', () => {
    const geometry = reviewedFixture()
    const reference = geometry.verticalReference
    if (!reference) throw new Error('Missing reference')
    reference.kind = 'existing-floor'
    for (const floor of reference.floors) floor.surface = 'existing-floor'
    expect(inspectPlanVerticalDimensions(geometry)[0]?.message).toContain('от чистого пола')
  })

  it('holds stale approval instead of reverting to the local flat comparison', () => {
    const geometry = reviewedFixture()
    const point = geometry.rooms[0]?.polygon[0]
    if (!point) throw new Error('Missing room vertex')
    point.xCm += 1
    expect(inspectPlanVerticalDimensions(geometry)[0]?.id).toBe('vertical-reference')
    expect(applyPlanVerticalDimensions(geometry, geometry).ok).toBe(false)
  })

  it('does not compare an aperture using a different room assigned to its host', () => {
    const geometry = reviewedFixture()
    const base = geometry.verticalReference?.wallBases[1]
    if (!base) throw new Error('Missing wall base')
    base.floorId = 'room-floor'
    expect(inspectPlanVerticalDimensions(geometry)[0]?.id).toBe('vertical-reference')
    expect(planVolume(geometry)).toBeNull()
  })

  it.each([null, false, 0, '', {}])('does not flatten malformed stored reference %j', (value) => {
    const geometry = reviewedFixture()
    Object.assign(geometry, { verticalReference: value })
    expect(planVolume(geometry)).toBeNull()
    expect(inspectMetricClearanceRoutes(geometry).result).toBeUndefined()
    expect(inspectPdfClearanceRoutes(geometry).result).toBeUndefined()
  })

  it('does not use a fresh datum to bypass missing wall or route evidence', () => {
    const geometry = reviewedFixture()
    expect(referenceTransferIssue(geometry)).toBeUndefined()
    expect(planVolume(geometry)).toBeNull()
    expect(apartmentVolume(geometry, []).model).toBeNull()
    expect(inspectMetricClearanceRoutes(geometry).result).toBeUndefined()
    expect(inspectMetricClearanceRoutes(geometry).missing).toContain('ширину прохода')
    expect(inspectPdfClearanceRoutes(geometry).result).toBeUndefined()
  })

  it('does not let the horizontal parser certify reference data or evade source revision checks', () => {
    const geometry = reviewedFixture()
    const horizontal = validatePlanGeometryEdit(geometry, 'draft')
    expect(horizontal).toBeDefined()
    expect(horizontal).not.toHaveProperty('verticalReference')
    const reading = { readAt: '2026-10-10T00:00:00.000Z', rooms: [], geometry }
    const before = planEditRevision('plan.pdf', reading)
    const reference = geometry.verticalReference
    if (!reference) throw new Error('Missing reference')
    reference.ceilings = []
    expect(planEditRevision('plan.pdf', reading)).not.toBe(before)
  })
})
