import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint, PlanWallFacePair } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { inspectFurnitureDeliveryViaStairs } from './plan-furniture-delivery'
import {
  type FurnitureStairSurvey,
  furnitureStairGeometryKey,
} from './plan-furniture-stair-transfer'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const point = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const box = (left: number, top: number, right: number, bottom: number) => [
  point(left, top),
  point(right, top),
  point(right, bottom),
  point(left, bottom),
]
const body = (points: PlanPoint[]): Polygon => [points.map(({ xCm, yCm }) => [xCm, yCm])]
const profile = { widthCm: 40, depthCm: 60, heightCm: 170, clearanceCm: 0, orientation: 0 as const }
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Incomplete synthetic delivery fixture')
  return value
}
/** Indoor source door zone, one measured flight and upper room; not exterior ingress evidence. */
function fixture(entryHeight: number | undefined = 220): PlanGeometry {
  const rooms = [
    { name: 'Lower room', polygon: box(0, 0, 250, 300) },
    { name: 'Upper room', polygon: box(530, 0, 980, 300) },
  ]
  const walls: PlanGeometry['walls'] = [
    { id: 'entry-face', kind: 'outer', start: point(0, 0), end: point(250, 0) },
    { id: 'entry-back', kind: 'outer', start: point(0, -20), end: point(250, -20) },
  ]
  const entry: PlanGeometry['openings'][number] = {
    id: 'entry',
    type: 'door',
    wallId: 'entry-face',
    offsetCm: 70,
    widthCm: 110,
    bottomCm: 0,
    ...(entryHeight === undefined ? {} : { heightCm: entryHeight }),
    clearance: { side: 'left', depthCm: 150, shape: 'rectangle' },
  }
  const pair: PlanWallFacePair = {
    faces: walls.map((wall, index) => ({
      wall: structuredClone(wall),
      start: wall.start,
      end: wall.end,
      nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: index },
    })) as PlanWallFacePair['faces'],
    openings: [structuredClone(entry)],
  }
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 980,
    heightCm: 300,
    rooms,
    walls,
    openings: [entry],
    warnings: [],
    footprint: box(0, 0, 980, 300),
    routeStartOpeningId: 'entry',
    routeWidthCm: 70,
    pdfCalibration: {
      sourceSha256: 'b'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      sourceWallFacePairs: [pair],
      openingWidthProofs: [
        {
          opening: structuredClone(entry),
          wall: structuredClone(required(walls[0])),
          cut: [point(70, 0), point(180, 0)],
          labelIndex: 0,
        },
      ],
    },
  }
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'delivery-survey',
      kind: 'finished-floor',
      zeroFloorId: 'lower',
      acknowledged: true,
      floors: rooms.map((room, index) => ({
        id: index ? 'upper' : 'lower',
        room,
        surface: 'finished-floor',
        elevationCm: index ? 198 : 0,
      })),
      ceilings: [
        { id: 'lower-head', floorId: 'lower', elevationCm: 360 },
        { id: 'upper-head', floorId: 'upper', elevationCm: 558 },
      ],
      wallBases: walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: 'lower',
      })),
      thresholds: [],
      source: {
        kind: 'site-measurement',
        reference: 'Synthetic complete measured indoor delivery path',
      },
    },
    'test-surveyor',
    '2026-10-11T12:30:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}
function survey(geometry: PlanGeometry): Extract<FurnitureStairSurvey, { version: 1 }> {
  return {
    version: 1,
    referenceKey: verticalReferenceReviewKey(required(geometry.verticalReference)),
    geometryKey: furnitureStairGeometryKey(geometry),
    source: { kind: 'site-measurement', reference: 'Synthetic measured 11-rise flight' },
    lowerFloorId: 'lower',
    upperFloorId: 'upper',
    direction: 'x',
    startCm: 0,
    crossStartCm: 90,
    widthCm: 120,
    lowerLandingLengthCm: 250,
    upperLandingLengthCm: 250,
    lowerLandingCeilingCm: 360,
    upperLandingCeilingCm: 558,
    treads: Array.from({ length: 10 }, (_, index) => ({
      runCm: 28,
      elevationCm: 18 * (index + 1),
      ceilingElevationCm: 360 + 18 * index,
    })),
    travelDirection: 'up',
    carryClearanceCm: 5,
    tilt: 'none',
    acknowledged: true,
  }
}

/** Explicit synthetic L-flight: a wide entry and a narrow final room require a real yaw. */
function turningDeliveryFixture() {
  const geometry = fixture()
  const entry = required(geometry.openings[0])
  entry.offsetCm = 15
  entry.widthCm = 220
  const calibration = required(geometry.pdfCalibration)
  const proof = required(calibration.openingWidthProofs?.[0])
  proof.opening = structuredClone(entry)
  proof.cut = [point(15, 0), point(235, 0)]
  required(calibration.sourceWallFacePairs?.[0]).openings = [structuredClone(entry)]
  geometry.heightCm = 900
  geometry.footprint = box(0, 0, 980, 900)
  geometry.rooms = [
    required(geometry.rooms[0]),
    { name: 'Upper room', polygon: box(490, 450, 610, 900) },
  ]
  calibration.wallFaceRoomPolygons = structuredClone(geometry.rooms.map((room) => room.polygon))
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'turning-delivery-survey',
      kind: 'finished-floor',
      zeroFloorId: 'lower',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: index ? 'upper' : 'lower',
        room,
        surface: 'finished-floor',
        elevationCm: index ? 198 : 0,
      })),
      ceilings: [
        { id: 'lower-head', floorId: 'lower', elevationCm: 360 },
        { id: 'upper-head', floorId: 'upper', elevationCm: 558 },
      ],
      wallBases: geometry.walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: 'lower',
      })),
      thresholds: [],
      source: {
        kind: 'site-measurement',
        reference: 'Synthetic complete measured L-flight delivery path',
      },
    },
    'test-surveyor',
    '2026-10-11T13:30:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  const current = accepted.geometry
  const input: Extract<FurnitureStairSurvey, { version: 2 }> = {
    version: 2,
    referenceKey: verticalReferenceReviewKey(required(current.verticalReference)),
    geometryKey: furnitureStairGeometryKey(current),
    source: { kind: 'site-measurement', reference: 'Synthetic explicit two-flight L survey' },
    lowerFloorId: 'lower',
    upperFloorId: 'upper',
    travelDirection: 'up',
    carryClearanceCm: 5,
    tilt: 'none',
    allowQuarterTurns: true,
    acknowledged: true,
    layout: [
      { kind: 'landing', polygon: box(0, 90, 250, 210), elevationCm: 0, ceilingElevationCm: 360 },
      ...Array.from({ length: 5 }, (_, index) => ({
        kind: 'tread' as const,
        polygon: box(250 + 28 * index, 90, 278 + 28 * index, 210),
        elevationCm: 18 * (index + 1),
        ceilingElevationCm: 500,
      })),
      {
        kind: 'landing',
        polygon: box(390, 90, 610, 310),
        elevationCm: 90,
        ceilingElevationCm: 500,
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        kind: 'tread' as const,
        polygon: box(490, 310 + 28 * index, 610, 338 + 28 * index),
        elevationCm: 108 + 18 * index,
        ceilingElevationCm: 558,
      })),
      {
        kind: 'landing',
        polygon: box(490, 450, 610, 700),
        elevationCm: 198,
        ceilingElevationCm: 558,
      },
    ],
  }
  const furniture = {
    widthCm: 60,
    depthCm: 180,
    heightCm: 170,
    clearanceCm: 2,
    orientation: 90 as const,
  }
  return { geometry: current, input, profile: furniture }
}

describe('continuous indoor delivery through a measured stair flight', () => {
  it('preserves a certified stair yaw through a narrow-room exit and charges the shared work budget', () => {
    const { geometry, input, profile: furniture } = turningDeliveryFixture()
    const before = structuredClone({ geometry, input, furniture })
    const disabled = inspectFurnitureDeliveryViaStairs(
      geometry,
      { ...input, allowQuarterTurns: false },
      furniture,
      '1',
    )
    expect(disabled.result).toBeUndefined()
    const response = inspectFurnitureDeliveryViaStairs(geometry, input, furniture, '1')
    expect(response.error).toBeUndefined()
    const result = required(response.result)
    expect(result.segments.entry[0]?.orientation).toBe(0)
    expect(result.segments.entry.at(-1)).toEqual(result.segments.stairs[0])
    expect(result.segments.stairs.at(-1)).toEqual(result.segments.exit[0])
    expect(result.segments.stairs.at(-1)?.orientation).toBe(90)
    expect(result.segments.exit.every((position) => position.orientation === 90)).toBe(true)
    expect(result.stairs.stages.filter((stage) => stage.kind === 'turn')).toHaveLength(1)
    const entry = inspectPdfClearanceRoutes(geometry, {
      widthCm: 184,
      depthCm: 64,
      heightCm: 172,
      goal: { roomId: '0', point: required(result.stairs.points[0]) },
      maxNodes: 6000,
    })
    const exit = inspectPdfClearanceRoutes(geometry, {
      widthCm: 64,
      depthCm: 184,
      heightCm: 172,
      origin: { floorId: 'upper', point: required(result.stairs.points.at(-1)) },
      goal: { roomId: '1' },
      maxNodes: 6000,
    })
    expect(result.checkedNodes).toBe(
      required(result.stairs.checkedStages) +
        required(entry.result).checkedNodes +
        required(exit.result).checkedNodes,
    )
    expect(result.checkedNodes).toBeLessThanOrEqual(6000)
    const room = body(required(geometry.rooms[1]).polygon)
    for (const position of result.segments.exit) {
      expect(
        polygonClipping.difference(
          body(box(position.xCm - 32, position.yCm - 92, position.xCm + 32, position.yCm + 92)),
          room,
        ),
      ).toEqual([])
      expect(position.zCm).toBe(198)
    }
    expect({ geometry, input, furniture }).toEqual(before)
  })
  it('joins the indoor entry, stair and target by exact XYZ without mutating input', () => {
    const geometry = fixture()
    const input = survey(geometry)
    const before = structuredClone({ geometry, input, profile })
    const response = inspectFurnitureDeliveryViaStairs(geometry, input, profile, '1')
    expect(response.error).toBeUndefined()
    const result = required(response.result)
    expect(result.segments.entry[0]).toEqual({ xCm: 125, yCm: 75, zCm: 0 })
    expect(result.segments.entry.at(-1)).toEqual(result.segments.stairs[0])
    expect(result.segments.stairs.at(-1)).toEqual(result.segments.exit[0])
    expect(result.segments.entry.at(-1)).toEqual({ xCm: 125, yCm: 150, zCm: 0 })
    expect(result.points.some((position) => position.zCm > 0 && position.zCm < 198)).toBe(true)
    expect(result.points.at(-1)?.zCm).toBe(198)
    expect(result.checkedNodes).toBeGreaterThan(result.stairs.stages.length)
    expect(result.checkedNodes).toBeLessThanOrEqual(6000)
    expect(result.targetRoomId).toBe('1')
    expect(response.notes.join(' ')).toContain('сам внешний занос не объявляются проверенными')
    expect({ geometry, input, profile }).toEqual(before)
  })
  it('checks the complete off-grid final connector segment, not just the grid node', () => {
    const geometry = fixture()
    const goal = { xCm: 125, yCm: 147.3 }
    const inspected = inspectPdfClearanceRoutes(geometry, {
      ...profile,
      maxNodes: 1000,
      goal: { roomId: '0', point: goal },
    })
    expect(inspected.missing).toBeUndefined()
    const route = required(inspected.result?.routes.find((route) => route.roomId === '0'))
    expect(route.points.at(-1)).toMatchObject(goal)
    const room = body(required(geometry.rooms[0]).polygon)
    for (const [index, current] of route.points.entries()) {
      const previous = route.points[index - 1] ?? current
      const sweep = body(
        box(
          Math.min(current.xCm, previous.xCm) - 20,
          Math.min(current.yCm, previous.yCm) - 30,
          Math.max(current.xCm, previous.xCm) + 20,
          Math.max(current.yCm, previous.yCm) + 30,
        ),
      )
      expect(polygonClipping.difference(sweep, room)).toEqual([])
    }
    const blocked = inspectPdfClearanceRoutes(geometry, {
      ...profile,
      maxNodes: 1000,
      goal: { roomId: '0', point: goal },
      extraSolids: [body(box(110, 142, 140, 146))],
    })
    expect(blocked.result?.routes.some((route) => route.roomId === '0')).toBe(false)
  })
  it.each(['-1', '01', '2', 'no-room'])('rejects noncanonical or missing target %s', (target) => {
    const geometry = fixture()
    expect(
      inspectFurnitureDeliveryViaStairs(geometry, survey(geometry), profile, target).error,
    ).toBeDefined()
  })
  it('does not certify a target on the wrong floor', () => {
    const geometry = fixture()
    expect(
      inspectFurnitureDeliveryViaStairs(geometry, survey(geometry), profile, '0').result,
    ).toBeUndefined()
  })
  it('requires a complete start aperture projection', () => {
    const geometry = fixture()
    const result = inspectFurnitureDeliveryViaStairs(
      geometry,
      survey(geometry),
      { ...profile, widthCm: 110.00000000001 },
      '1',
    )
    expect(result.error).toContain('шире')
    expect(result.result).toBeUndefined()
  })
  it.each([undefined, 169.999999999])('holds unknown or insufficient entry head %s', (height) => {
    const geometry = fixture(height)
    if (height === undefined) delete required(geometry.openings[0]).heightCm
    const result = inspectFurnitureDeliveryViaStairs(geometry, survey(geometry), profile, '1')
    expect(result.result).toBeUndefined()
  })
  it.each(['survey', 'wall', 'reference'] as const)('holds stale %s context', (mode) => {
    const geometry = fixture()
    const input = survey(geometry)
    if (mode === 'survey') input.geometryKey += 'stale'
    if (mode === 'wall') required(geometry.walls[0]).end.xCm += 1
    if (mode === 'reference')
      required(required(required(geometry.verticalReference).ceilings)[0]).elevationCm -= 1
    expect(inspectFurnitureDeliveryViaStairs(geometry, input, profile, '1').result).toBeUndefined()
  })
  it('refuses changed source cuts even with a refreshed stair request context', () => {
    const geometry = fixture()
    required(geometry.openings[0]).widthCm -= 1
    expect(
      inspectFurnitureDeliveryViaStairs(geometry, survey(geometry), profile, '1').result,
    ).toBeUndefined()
  })
  it('requires one authoritative entry proof instead of competing claims', () => {
    const geometry = fixture()
    const proofs = required(required(geometry.pdfCalibration).openingWidthProofs)
    proofs.push(structuredClone(required(proofs[0])))
    expect(
      inspectFurnitureDeliveryViaStairs(geometry, survey(geometry), profile, '1').error,
    ).toContain('стартовая дверь')
  })
  it('holds blocked or too-small interior start zones instead of creating outside space', () => {
    const geometry = fixture()
    required(geometry.openings[0]).clearance = { side: 'right', depthCm: 150, shape: 'rectangle' }
    expect(
      inspectFurnitureDeliveryViaStairs(geometry, survey(geometry), profile, '1').result,
    ).toBeUndefined()
  })
  it('charges off-grid connector points against the same bounded search budget', () => {
    const geometry = fixture()
    const goal = { roomId: '0', point: { xCm: 125, yCm: 147.3 } }
    const limited = inspectPdfClearanceRoutes(geometry, { ...profile, goal, maxNodes: 1 })
    expect(limited.result?.reason).toBe('search-limit')
    expect(limited.result?.checkedNodes).toBeLessThanOrEqual(1)
    expect(limited.result?.routes).toEqual([])
    const checked = inspectPdfClearanceRoutes(geometry, { ...profile, goal, maxNodes: 2 })
    expect(checked.result?.routes[0]?.points.at(-1)).toMatchObject(goal.point)
    expect(checked.result?.checkedNodes).toBe(2)
  })
  it('compares connector headroom sums exactly instead of rounding an oversize sum down', () => {
    const geometry = fixture()
    const reference = required(geometry.verticalReference)
    required(reference.floors.find((floor) => floor.id === 'upper')).elevationCm =
      198.00000000000006
    required(reference.ceilings?.find((ceiling) => ceiling.floorId === 'upper')).elevationCm =
      318.00000000000006
    const inspected = inspectPdfClearanceRoutes(geometry, {
      ...profile,
      heightCm: 120.00000000000001,
      origin: { floorId: 'upper', point: { xCm: 655, yCm: 150 } },
      goal: { roomId: '1' },
    })
    expect(inspected.result?.routes.some((route) => route.roomId === '1') ?? false).toBe(false)
  })
})
