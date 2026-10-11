import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
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
function survey(geometry: PlanGeometry): FurnitureStairSurvey {
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
    expect(result.error).toMatch(/грани стен PDF/)
    expect(result.result).toBeUndefined()
  })
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
