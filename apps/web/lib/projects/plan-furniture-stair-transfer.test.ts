import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint, PlanWallFacePair } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import {
  type FurnitureStairSurvey,
  furnitureStairGeometryKey,
  inspectFurnitureStairTransfer,
} from './plan-furniture-stair-transfer'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const box = (left: number, top: number, right: number, bottom: number): PlanPoint[] => [
  { xCm: left, yCm: top },
  { xCm: right, yCm: top },
  { xCm: right, yCm: bottom },
  { xCm: left, yCm: bottom },
]
const profile = { widthCm: 55, depthCm: 65, heightCm: 170, clearanceCm: 2, orientation: 0 as const }
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Incomplete synthetic stair survey')
  return value
}
/** Explicit synthetic 11-rise straight flight: 18 cm rises, 28 cm runs, 120 cm clear width. */
function fixture(direction: 'x' | 'y' = 'x'): PlanGeometry {
  const rooms = [
    { name: 'Нижняя площадка', polygon: box(0, 0, 250, 300) },
    { name: 'Верхняя площадка', polygon: box(530, 0, 780, 300) },
  ]
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 780,
    heightCm: 300,
    footprint: box(0, 0, 780, 300),
    rooms,
    walls: [],
    openings: [],
    warnings: [],
  }
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'stairs-survey',
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
      wallBases: [],
      thresholds: [],
      source: { kind: 'site-measurement', reference: 'Synthetic measured straight flight' },
    },
    'test-surveyor',
    '2026-10-11T08:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  if (direction === 'x') return accepted.geometry
  const rotated = JSON.parse(
    JSON.stringify(accepted.geometry, (_key, value) => {
      if (value && typeof value === 'object' && 'xCm' in value && 'yCm' in value)
        return { xCm: value.yCm, yCm: value.xCm }
      return value
    }),
  ) as PlanGeometry
  rotated.widthCm = 300
  rotated.heightCm = 780
  return rotated
}
function survey(geometry: PlanGeometry): Extract<FurnitureStairSurvey, { version: 1 }> {
  if (!geometry.verticalReference) throw new Error('Missing reference')
  return {
    version: 1,
    referenceKey: verticalReferenceReviewKey(geometry.verticalReference),
    geometryKey: furnitureStairGeometryKey(geometry),
    source: { kind: 'site-measurement', reference: 'Synthetic explicit tape measurements' },
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

function turningFixture(uTurn = false, turnWidth = 160) {
  const original = fixture()
  const geometry = {
    ...original,
    heightCm: 900,
    footprint: box(0, 0, 780, 900),
    verticalReference: undefined,
  }
  const lowerRoom = required(geometry.rooms?.[0])
  const upperRoom = {
    name: 'Верхняя площадка',
    polygon: uTurn ? box(0, 300, 250, 550) : box(350, 230 + turnWidth, 780, 900),
  }
  geometry.rooms = [lowerRoom, upperRoom]
  const reference = required(original.verticalReference)
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: reference.id,
      kind: reference.kind,
      zeroFloorId: reference.zeroFloorId,
      acknowledged: true,
      ceilings: reference.ceilings,
      wallBases: reference.wallBases,
      thresholds: reference.thresholds,
      source: reference.source,
      floors: reference.floors.map((floor) => ({
        ...floor,
        room: floor.id === 'lower' ? lowerRoom : upperRoom,
      })),
    },
    'test-surveyor',
    '2026-10-11T08:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  const result = accepted.geometry
  const common = survey(result)
  const layout: Extract<FurnitureStairSurvey, { version: 2 }>['layout'] = [
    { kind: 'landing', polygon: box(0, 90, 250, 210), elevationCm: 0, ceilingElevationCm: 360 },
    ...Array.from({ length: 5 }, (_, index) => ({
      kind: 'tread' as const,
      polygon: box(250 + index * 28, 90, 278 + index * 28, 210),
      elevationCm: 18 * (index + 1),
      ceilingElevationCm: 500,
    })),
    {
      kind: 'landing',
      polygon: box(390, 90, 390 + turnWidth, uTurn ? 430 : 90 + turnWidth),
      elevationCm: 90,
      ceilingElevationCm: 500,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      kind: 'tread' as const,
      polygon: uTurn
        ? box(362 - index * 28, 310, 390 - index * 28, 430)
        : box(
            270 + turnWidth,
            90 + turnWidth + index * 28,
            390 + turnWidth,
            118 + turnWidth + index * 28,
          ),
      elevationCm: 108 + index * 18,
      ceilingElevationCm: 558,
    })),
    {
      kind: 'landing',
      polygon: uTurn
        ? box(0, 310, 250, 430)
        : box(270 + turnWidth, 230 + turnWidth, 390 + turnWidth, 480 + turnWidth),
      elevationCm: 198,
      ceilingElevationCm: 558,
    },
  ]
  const input: Extract<FurnitureStairSurvey, { version: 2 }> = {
    version: 2,
    referenceKey: common.referenceKey,
    geometryKey: common.geometryKey,
    source: common.source,
    lowerFloorId: common.lowerFloorId,
    upperFloorId: common.upperFloorId,
    travelDirection: 'up',
    carryClearanceCm: 5,
    tilt: 'none',
    acknowledged: true,
    layout,
  }
  return { geometry: result, input }
}

describe('explicit turning measured stair chain', () => {
  it.each(['up', 'down'] as const)(
    'certifies an actual whole furniture yaw on the intermediate landing: %s',
    (travelDirection) => {
      const { geometry, input } = turningFixture(false, 220)
      const body = {
        ...profile,
        widthCm: 60,
        depthCm: 180,
        orientation: travelDirection === 'up' ? (90 as const) : (0 as const),
      }
      expect(
        inspectFurnitureStairTransfer(geometry, { ...input, travelDirection }, body).result,
      ).toBeUndefined()
      const response = inspectFurnitureStairTransfer(
        geometry,
        { ...input, travelDirection, allowQuarterTurns: true },
        body,
      )
      expect(response.error).toBeUndefined()
      const result = required(response.result)
      expect(result.points[0]?.orientation).toBe(0)
      expect(result.points.at(-1)?.orientation).toBe(90)
      const turns = result.stages.filter((stage) => stage.kind === 'turn')
      expect(turns).toHaveLength(1)
      const turn = required(turns[0])
      expect([turn.from.xCm, turn.from.yCm, turn.from.zCm]).toEqual([
        turn.to.xCm,
        turn.to.yCm,
        turn.to.zCm,
      ])
      expect(turn.from.orientation).toBe(0)
      expect(turn.to.orientation).toBe(90)
      const landing = required(result.regions[6])
      const sweep: Polygon = [
        box(turn.bounds.leftCm, turn.bounds.topCm, turn.bounds.rightCm, turn.bounds.bottomCm).map(
          (point) => [point.xCm, point.yCm],
        ),
      ]
      expect(
        polygonClipping.difference(sweep, [
          landing.polygon.map((point) => [point.xCm, point.yCm] as [number, number]),
        ]),
      ).toEqual([])
      expect((turn.bounds.rightCm - turn.bounds.leftCm) ** 2).toBeGreaterThanOrEqual(
        64 ** 2 + 184 ** 2,
      )
      expect(result.checkedStages).toBeGreaterThanOrEqual(result.stages.length)
      expect(result.checkedStages).toBeLessThanOrEqual(6000)
      expect(result.points.at(-1)?.zCm).toBe(travelDirection === 'up' ? 198 : 0)
    },
  )
  it.each(['small-landing', 'obstacle', 'head'] as const)(
    'does not accept an unsafe whole yaw sweep: %s',
    (failure) => {
      const { geometry, input } = turningFixture(false, failure === 'small-landing' ? 160 : 220)
      if (failure === 'head') required(input.layout[6]).ceilingElevationCm = 240
      if (failure === 'obstacle') {
        geometry.obstacles = [
          { id: 'turn-corner', kind: 'fixed', xCm: 405, yCm: 105, widthCm: 5, depthCm: 5 },
        ]
        input.geometryKey = furnitureStairGeometryKey(geometry)
      }
      const response = inspectFurnitureStairTransfer(
        geometry,
        { ...input, allowQuarterTurns: true },
        { ...profile, widthCm: 60, depthCm: 180, orientation: 90 },
      )
      expect(response.result).toBeUndefined()
    },
  )
  it.each(['up', 'down'] as const)(
    'combines fixed arbitrary tilt with a certified horizontal yaw and final untilt: %s',
    (travelDirection) => {
      const { geometry, input } = turningFixture(false, 220)
      const response = inspectFurnitureStairTransfer(
        geometry,
        {
          ...input,
          travelDirection,
          allowQuarterTurns: true,
          tilt: 'width',
          angleDeg: 30,
        },
        {
          ...profile,
          widthCm: 60,
          depthCm: 180,
          heightCm: 60,
          orientation: travelDirection === 'up' ? 90 : 0,
        },
      )
      expect(response.error).toBeUndefined()
      const result = required(response.result)
      expect(result.stages.some((stage) => stage.kind === 'turn')).toBe(true)
      expect(result.stages.find((stage) => stage.kind === 'tilt')?.from.orientation).toBe(0)
      expect(result.stages.find((stage) => stage.kind === 'untilt')?.to.orientation).toBe(90)
      expect(result.points.at(-1)?.zCm).toBe(travelDirection === 'up' ? 198 : 0)
    },
  )
  it('does not turn on a large tread even when its swept square could fit horizontally', () => {
    const { geometry, input } = turningFixture(false, 220)
    const region = required(input.layout[6])
    region.kind = 'tread'
    region.elevationCm = 99
    expect(
      inspectFurnitureStairTransfer(
        geometry,
        { ...input, allowQuarterTurns: true },
        {
          ...profile,
          widthCm: 60,
          depthCm: 180,
          orientation: 90,
        },
      ).result,
    ).toBeUndefined()
  })
  it('preserves absent/false quarter-turn policy and never adds orientation metadata by default', () => {
    const { geometry, input } = turningFixture()
    const result = inspectFurnitureStairTransfer(geometry, input, profile)
    expect(
      inspectFurnitureStairTransfer(geometry, { ...input, allowQuarterTurns: false }, profile),
    ).toEqual(result)
    expect(result.result?.points.every((point) => !Object.hasOwn(point, 'orientation'))).toBe(true)
    expect(Object.hasOwn(required(result.result), 'checkedStages')).toBe(false)
  })
  it.each([false, true])('certifies a measured %s turning chain in both directions', (uTurn) => {
    const { geometry, input } = turningFixture(uTurn)
    for (const travelDirection of ['up', 'down'] as const) {
      const response = inspectFurnitureStairTransfer(
        geometry,
        { ...input, travelDirection },
        profile,
      )
      expect(response.error).toBeUndefined()
      const result = required(response.result)
      expect(result.points[0]?.zCm).toBe(travelDirection === 'up' ? 0 : 198)
      expect(result.points.at(-1)?.zCm).toBe(travelDirection === 'up' ? 198 : 0)
      expect(result.regions).toHaveLength(13)
      for (const stage of result.stages.filter((stage) => stage.kind === 'translate')) {
        expect(stage.from.xCm === stage.to.xCm || stage.from.yCm === stage.to.yCm).toBe(true)
        expect(stage.from.zCm).toBe(stage.to.zCm)
      }
      const bodies = result.regions.map(
        (region): Polygon => [region.polygon.map((point) => [point.xCm, point.yCm])],
      )
      const union = polygonClipping.union(required(bodies[0]), ...bodies.slice(1))
      for (const stage of result.stages) {
        const bounds = stage.bounds
        const sweep: Polygon = [
          box(bounds.leftCm, bounds.topCm, bounds.rightCm, bounds.bottomCm).map((point) => [
            point.xCm,
            point.yCm,
          ]),
        ]
        expect(polygonClipping.difference(sweep, union)).toEqual([])
        for (const region of result.regions) {
          const regionBody: Polygon = [region.polygon.map((point) => [point.xCm, point.yCm])]
          if (!polygonClipping.intersection(sweep, regionBody).length) continue
          expect(bounds.bottomElevationCm).toBeGreaterThanOrEqual(region.elevationCm)
          expect(bounds.topElevationCm).toBeLessThanOrEqual(region.ceilingElevationCm)
        }
      }
    }
  })
  it('preserves the legacy result exactly when converting a straight chain to explicit regions', () => {
    const geometry = fixture()
    const legacy = required(
      inspectFurnitureStairTransfer(geometry, survey(geometry), profile).result,
    )
    const { input } = turningFixture()
    const common = survey(geometry)
    const explicit = {
      ...input,
      referenceKey: common.referenceKey,
      geometryKey: common.geometryKey,
      layout: legacy.regions.map(({ index: _index, ...region }) => region),
    }
    expect(inspectFurnitureStairTransfer(geometry, explicit, profile).result).toEqual(legacy)
  })
  it.each(['gap', 'overlap', 'corner', 'diagonal', 'reversed-height', 'unknown-head'] as const)(
    'holds invalid measured topology: %s',
    (failure) => {
      const { geometry, input } = turningFixture()
      const region = required(input.layout[6])
      if (failure === 'gap') region.polygon = box(391, 90, 550, 250)
      if (failure === 'overlap') region.polygon = box(380, 90, 550, 250)
      if (failure === 'corner') region.polygon = box(390, 210, 550, 250)
      if (failure === 'diagonal') required(region.polygon[1]).yCm += 1
      if (failure === 'reversed-height') region.elevationCm = 80
      if (failure === 'unknown-head') region.ceilingElevationCm = Number.NaN
      expect(inspectFurnitureStairTransfer(geometry, input, profile).result).toBeUndefined()
    },
  )
  it('does not invent yaw rotation when the fixed envelope cannot traverse a measured bend', () => {
    const { geometry, input } = turningFixture()
    expect(
      inspectFurnitureStairTransfer(geometry, input, { ...profile, widthCm: 160 }).result,
    ).toBeUndefined()
  })
  it('holds low ceiling over the next higher step reached by the whole furniture envelope', () => {
    const { geometry, input } = turningFixture()
    required(input.layout[8]).ceilingElevationCm = 200
    expect(inspectFurnitureStairTransfer(geometry, input, profile).result).toBeUndefined()
  })
  it('cannot bypass a fixed object inside the intermediate turning landing', () => {
    const { geometry, input } = turningFixture()
    geometry.obstacles = [
      { id: 'measured-cabinet', kind: 'fixed', xCm: 450, yCm: 160, widthCm: 30, depthCm: 30 },
    ]
    input.geometryKey = furnitureStairGeometryKey(geometry)
    expect(inspectFurnitureStairTransfer(geometry, input, profile).result).toBeUndefined()
  })
  it('does not replace an existing void with a measured turning landing', () => {
    const { geometry, input } = turningFixture()
    geometry.voids = [{ id: 'surveyed-hole', polygon: box(450, 160, 480, 190) }]
    required(geometry.verticalReference).contextSnapshot.voids = structuredClone(geometry.voids)
    input.geometryKey = furnitureStairGeometryKey(geometry)
    input.referenceKey = verticalReferenceReviewKey(required(geometry.verticalReference))
    expect(inspectFurnitureStairTransfer(geometry, input, profile).error).toMatch(/пустоту/)
  })
  it('rejects a measured intermediate landing covering an already recorded physical floor', () => {
    const { geometry, input } = turningFixture()
    const landing = required(input.layout[6])
    landing.polygon = box(0, 0, 100, 100)
    expect(inspectFurnitureStairTransfer(geometry, input, profile).result).toBeUndefined()
  })
})
describe('local measured straight-flight furniture transfer', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'holds a malformed fixed obstacle rather than ignoring or reversing its solid: %j',
    (widthCm) => {
      const geometry = fixture()
      geometry.obstacles = [
        { id: 'invalid-fixed', kind: 'fixed', xCm: 300, yCm: 250, widthCm, depthCm: 10 },
      ]
      const response = inspectFurnitureStairTransfer(geometry, survey(geometry), profile)
      expect(response.result).toBeUndefined()
      expect(response.error).toBeTruthy()
    },
  )
  it.each(['up', 'down'] as const)(
    'constructs an entirely checked variable-elevation %s path',
    (travelDirection) => {
      const geometry = fixture()
      const input = { ...survey(geometry), travelDirection }
      const result = inspectFurnitureStairTransfer(geometry, input, profile)
      expect(result.error).toBeUndefined()
      expect(result.result?.regions).toHaveLength(12)
      expect(new Set(result.result?.points.map((point) => point.zCm)).size).toBeGreaterThan(5)
      expect(result.result?.points[0]?.zCm).toBe(travelDirection === 'up' ? 0 : 198)
      expect(result.result?.points.at(-1)?.zCm).toBe(travelDirection === 'up' ? 198 : 0)
      expect(result.result?.stages.filter((stage) => stage.kind === 'translate')).toHaveLength(11)
      for (const stage of result.result?.stages ?? []) {
        expect(stage.bounds.topElevationCm).toBeGreaterThan(stage.bounds.bottomElevationCm)
        if (stage.kind === 'translate') expect(stage.from.zCm).toBe(stage.to.zCm)
        else expect([stage.from.xCm, stage.from.yCm]).toEqual([stage.to.xCm, stage.to.yCm])
      }
    },
  )
  it('lifts ahead of the riser according to the full overhanging body, not centre tread', () => {
    const geometry = fixture()
    const result = inspectFurnitureStairTransfer(geometry, survey(geometry), {
      ...profile,
      widthCm: 150,
    })
    const first = result.result?.stages.find((stage) => stage.kind === 'translate')
    expect(result.error).toBeUndefined()
    expect(first?.to.xCm).toBe(264)
    expect(first?.to.zCm).toBe(77) // footprint reaches the fourth 72 cm tread, plus 5 cm explicit lift gap
  })
  it('supports a fixed arbitrary-angle carried pose with whole endpoint tilt envelopes', () => {
    const geometry = fixture()
    const result = inspectFurnitureStairTransfer(
      geometry,
      { ...survey(geometry), tilt: 'depth', angleDeg: 30 },
      { ...profile, depthCm: 35, heightCm: 105 },
    )
    expect(result.error).toBeUndefined()
    expect(result.result?.angleDeg).toBe(30)
    expect(result.result?.stages.some((stage) => stage.kind === 'tilt')).toBe(true)
    expect(result.result?.stages.some((stage) => stage.kind === 'untilt')).toBe(true)
    expect(result.result?.sweepHeightCm).toBeGreaterThan(
      result.result?.carried.heightCm ?? Infinity,
    )
  })
  it('swaps the horizontal carried dimensions for explicit initial orientation', () => {
    const geometry = fixture()
    const normal = inspectFurnitureStairTransfer(geometry, survey(geometry), profile).result
    const rotated = inspectFurnitureStairTransfer(geometry, survey(geometry), {
      ...profile,
      orientation: 90,
    }).result
    expect(rotated?.carried.widthCm).toBe(normal?.carried.depthCm)
    expect(rotated?.carried.depthCm).toBe(normal?.carried.widthCm)
  })
  it.each(['up', 'down'] as const)(
    'checks a Y-aligned %s flight without inventing a diagonal staircase',
    (travelDirection) => {
      const geometry = fixture('y')
      const result = inspectFurnitureStairTransfer(
        geometry,
        { ...survey(geometry), direction: 'y', travelDirection },
        profile,
      )
      expect(result.error).toBeUndefined()
      expect(new Set(result.result?.points.map((point) => point.xCm))).toEqual(new Set([150]))
      expect(new Set(result.result?.points.map((point) => point.yCm)).size).toBe(12)
    },
  )
  it.each(['up', 'down'] as const)(
    'independently replays all %s swept bounds against every measured region',
    (travelDirection) => {
      const geometry = fixture()
      const result = required(
        inspectFurnitureStairTransfer(geometry, { ...survey(geometry), travelDirection }, profile)
          .result,
      )
      for (const stage of result.stages) {
        const bounds = stage.bounds
        expect(bounds.leftCm).toBeGreaterThanOrEqual(0)
        expect(bounds.rightCm).toBeLessThanOrEqual(780)
        expect(bounds.topCm).toBeGreaterThanOrEqual(90)
        expect(bounds.bottomCm).toBeLessThanOrEqual(210)
        const affected = result.regions.filter((region) => {
          const lower = required(region.polygon[0])
          const upper = required(region.polygon[2])
          return (
            bounds.leftCm < upper.xCm &&
            bounds.rightCm > lower.xCm &&
            bounds.topCm < upper.yCm &&
            bounds.bottomCm > lower.yCm
          )
        })
        expect(affected.length).toBeGreaterThan(0)
        for (const region of affected) {
          expect(bounds.bottomElevationCm).toBeGreaterThanOrEqual(region.elevationCm)
          expect(bounds.topElevationCm).toBeLessThanOrEqual(region.ceilingElevationCm)
        }
        expect(bounds.bottomElevationCm).toBe(Math.min(stage.from.zCm, stage.to.zCm))
        expect(bounds.topElevationCm).toBeGreaterThanOrEqual(
          Math.max(stage.from.zCm, stage.to.zCm) + result.carried.heightCm,
        )
      }
    },
  )
  it.each([{}, { angleDeg: 0 }, { angleDeg: 90 }, { angleDeg: 30 }])(
    'holds an unconfirmed/contradictory survey %j',
    (extra) => {
      const geometry = fixture()
      const input = { ...survey(geometry), ...extra, acknowledged: false }
      expect(inspectFurnitureStairTransfer(geometry, input, profile).result).toBeUndefined()
    },
  )
  it.each([
    { unknown: true },
    { widthCm: 0 },
    { widthCm: Infinity },
    { carryClearanceCm: -1 },
    { direction: 'diagonal' },
    { tilt: 'none', angleDeg: 12 },
    { angleDeg: 91 },
    { treads: [] },
    { lowerFloorId: 'upper' },
    { upperFloorId: 'missing' },
    { lowerLandingCeilingCm: 361 },
    { geometryKey: 'stale' },
    { referenceKey: 'stale' },
    { source: { kind: 'site-measurement', reference: '' } },
  ])('rejects malformed or stale fields %j', (extra) => {
    const geometry = fixture()
    const result = inspectFurnitureStairTransfer(
      geometry,
      { ...survey(geometry), ...extra },
      profile,
    )
    expect(result.error).toBeTruthy()
    expect(result.result).toBeUndefined()
  })
  it('holds a low intermediate underside without returning a partial successful path', () => {
    const geometry = fixture()
    const input = survey(geometry)
    required(input.treads[5]).ceilingElevationCm = 200
    const result = inspectFurnitureStairTransfer(geometry, input, profile)
    expect(result.error).toMatch(/потолок/)
    expect(result.result).toBeUndefined()
  })
  it('holds an unknown landing ceiling instead of using a structural wall height', () => {
    const geometry = fixture()
    required(geometry.verticalReference).ceilings = required(
      required(geometry.verticalReference).ceilings,
    ).filter((item) => item.floorId !== 'upper')
    expect(inspectFurnitureStairTransfer(geometry, survey(geometry), profile).error).toMatch(
      /потолки/,
    )
  })
  it('holds a raised future tread that the long body overhang reaches', () => {
    const geometry = fixture()
    const input = survey(geometry)
    required(input.treads[3]).ceilingElevationCm = 210
    const result = inspectFurnitureStairTransfer(geometry, input, { ...profile, widthCm: 150 })
    expect(result.error).toMatch(/потолок/)
  })
  it('holds overlapping or descending risers and any unknown tread head', () => {
    const geometry = fixture()
    for (const replacement of [0, 18, 199, Infinity]) {
      const input = survey(geometry)
      required(input.treads[1]).elevationCm = replacement
      expect(inspectFurnitureStairTransfer(geometry, input, profile).result).toBeUndefined()
    }
  })
  it('holds an endpoint where the full diagonal tilt sweep cannot fit', () => {
    const geometry = fixture()
    expect(
      inspectFurnitureStairTransfer(
        geometry,
        { ...survey(geometry), tilt: 'depth', angleDeg: 1 },
        profile,
      ).error,
    ).toMatch(/площадке/)
  })
  it('does not overwrite a recorded void even with acknowledged step measurements', () => {
    const geometry = fixture()
    geometry.voids = [{ id: 'hole', polygon: box(330, 100, 345, 130) }]
    required(geometry.verticalReference).contextSnapshot.voids = structuredClone(geometry.voids)
    expect(inspectFurnitureStairTransfer(geometry, survey(geometry), profile).error).toMatch(
      /пустоту/,
    )
  })
  it('does not fly over a recorded stationary obstacle with unknown height', () => {
    const geometry = fixture()
    geometry.obstacles = [
      { id: 'fixed', kind: 'fixed', xCm: 345, yCm: 130, widthCm: 10, depthCm: 20 },
    ]
    expect(inspectFurnitureStairTransfer(geometry, survey(geometry), profile).error).toMatch(
      /неподвижный/,
    )
  })
  it('does not cut a raw wall or use its small structural height to fly over it', () => {
    const geometry = fixture()
    const wall = {
      id: 'landing-wall',
      kind: 'inner' as const,
      start: { xCm: 220, yCm: 90 },
      end: { xCm: 220, yCm: 210 },
      heightCm: 1,
      measuredThicknessCm: 20,
    }
    geometry.walls.push(wall)
    required(geometry.verticalReference).wallBases.push({
      wall: { id: wall.id, kind: wall.kind, start: wall.start, end: wall.end },
      floorId: 'lower',
    })
    const result = inspectFurnitureStairTransfer(geometry, survey(geometry), profile)
    expect(result.error).toMatch(/стену/)
    expect(result.result).toBeUndefined()
  })
  it('checks the reviewed solid wall thickness even when its raw axis misses the body', () => {
    const geometry = fixture()
    const wall = {
      id: 'solid-wall',
      kind: 'inner' as const,
      start: { xCm: 0, yCm: 185 },
      end: { xCm: 780, yCm: 185 },
      measuredThicknessCm: 20,
    }
    geometry.walls.push(wall)
    required(geometry.verticalReference).wallBases.push({
      wall: { id: wall.id, kind: wall.kind, start: wall.start, end: wall.end },
      floorId: 'lower',
    })
    const result = inspectFurnitureStairTransfer(geometry, survey(geometry), profile)
    expect(result.error).toMatch(/стену/)
    expect(result.result).toBeUndefined()
  })
  it('holds unknown physical walls rather than using an unsurveyed thicknessCm fallback', () => {
    const geometry = fixture()
    const wall = {
      id: 'unknown-wall',
      kind: 'inner' as const,
      start: { xCm: 0, yCm: 290 },
      end: { xCm: 250, yCm: 290 },
      thicknessCm: 5,
    }
    geometry.walls.push(wall)
    required(geometry.verticalReference).wallBases.push({ wall, floorId: 'lower' })
    expect(inspectFurnitureStairTransfer(geometry, survey(geometry), profile).error).toMatch(
      /Физическая толщина/,
    )
  })
  it('does not reinterpret a calibrated source wall face as an axis with symmetric thickness', () => {
    const geometry = fixture()
    const wall = {
      id: 'source-face',
      kind: 'inner' as const,
      start: { xCm: 0, yCm: 195 },
      end: { xCm: 780, yCm: 195 },
      measuredThicknessCm: 20,
    }
    geometry.walls.push(wall)
    required(geometry.verticalReference).wallBases.push({
      wall: { id: wall.id, kind: wall.kind, start: wall.start, end: wall.end },
      floorId: 'lower',
    })
    geometry.pdfCalibration = {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
    }
    required(geometry.verticalReference).contextSnapshot.pdfCalibration = {
      sourceSha256: geometry.pdfCalibration.sourceSha256,
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
    }
    const result = inspectFurnitureStairTransfer(geometry, survey(geometry), profile)
    expect(result.error).toMatch(/исходные грани PDF/)
    expect(result.result).toBeUndefined()
  })
  it.each([false, true])(
    'checks reviewed PDF wall strips along the full stair sweep: blocked=%s',
    (blocked) => {
      const geometry = fixture()
      const top = blocked ? 140 : 40
      geometry.walls = [top, top + 20].map((yCm, index) => ({
        id: `pdf-face-${index}`,
        kind: 'inner',
        start: { xCm: 0, yCm },
        end: { xCm: 780, yCm },
      }))
      required(geometry.verticalReference).wallBases = geometry.walls.map((wall) => ({
        wall,
        floorId: 'lower',
      }))
      geometry.pdfCalibration = {
        sourceSha256: 'a'.repeat(64),
        pdfPage: 1,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
        wallFaceRoomPolygons: geometry.rooms.map((room) => structuredClone(room.polygon)),
        sourceWallFacePairs: [
          {
            faces: geometry.walls.map((wall, index) => ({
              wall: structuredClone(wall),
              start: wall.start,
              end: wall.end,
              nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: index },
            })) as PlanWallFacePair['faces'],
            openings: [],
          },
        ],
      }
      required(geometry.verticalReference).contextSnapshot.pdfCalibration = {
        sourceSha256: geometry.pdfCalibration.sourceSha256,
        pdfPage: 1,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
      }
      const response = inspectFurnitureStairTransfer(geometry, survey(geometry), profile)
      if (blocked) expect(response.result).toBeUndefined()
      else expect(response.error).toBeUndefined()
    },
  )
  it('never mutates geometry or stores a new slab from explicit surveyed elevations', () => {
    const geometry = fixture()
    const before = JSON.stringify(geometry)
    expect(inspectFurnitureStairTransfer(geometry, survey(geometry), profile).result).toBeDefined()
    expect(JSON.stringify(geometry)).toBe(before)
  })
  it('defaults an explicit tilt axis to 90 degrees, but permits an explicit zero pose', () => {
    const geometry = fixture()
    const small = { ...profile, depthCm: 35, heightCm: 105 }
    const sideways = inspectFurnitureStairTransfer(
      geometry,
      { ...survey(geometry), tilt: 'depth' },
      small,
    )
    const upright = inspectFurnitureStairTransfer(
      geometry,
      { ...survey(geometry), tilt: 'depth', angleDeg: 0 },
      small,
    )
    expect(sideways.result?.angleDeg).toBe(90)
    expect(upright.result?.angleDeg).toBe(0)
    expect(upright.result?.stages.some((stage) => stage.kind === 'tilt')).toBe(false)
  })
  it('does not accept a fresh referenceKey with an obsolete geometry snapshot', () => {
    const geometry = fixture()
    const input = survey(geometry)
    geometry.obstacles = [
      { id: 'new-fixed', kind: 'fixed', xCm: 350, yCm: 130, widthCm: 10, depthCm: 20 },
    ]
    expect(inspectFurnitureStairTransfer(geometry, input, profile).error).toMatch(/изменились/)
  })
  it('rejects treads occupying a current known flat floor', () => {
    const geometry = fixture()
    const input = survey(geometry)
    input.lowerLandingLengthCm = 240
    input.upperLandingLengthCm = 260
    expect(inspectFurnitureStairTransfer(geometry, input, profile).error).toMatch(
      /площадка|перекрывают/,
    )
  })
  it('bounds the survey and defensively rejects invalid transport profiles', () => {
    const geometry = fixture()
    const input = survey(geometry)
    expect(
      inspectFurnitureStairTransfer(
        geometry,
        { ...input, treads: Array.from({ length: 65 }, () => input.treads[0]) },
        profile,
      ).result,
    ).toBeUndefined()
    for (const invalid of [
      { heightCm: NaN },
      { clearanceCm: -1 },
      { depthCm: 0 },
      { orientation: 45 },
    ])
      expect(
        inspectFurnitureStairTransfer(geometry, input, { ...profile, ...invalid } as typeof profile)
          .result,
      ).toBeUndefined()
  })
})
