import {
  inspectPlanThresholdSurfaces,
  planOpeningEndpoints,
} from '@uyut/catalog/plan-threshold-geometry'
import type { PlanGeometry, PlanOpeningBinding, PlanPoint, PlanWallFacePair } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { buildPlanScene } from './plan-scene-geometry'
import { applyPlanVerticalReference } from './plan-vertical-reference'
import { planVolume } from './plan-volume'

const p = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const box = (x: number, y: number, width: number, depth: number) => [
  p(x, y),
  p(x + width, y),
  p(x + width, y + depth),
  p(x, y + depth),
]
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Incomplete synthetic fixture')
  return value
}

type FixtureOptions = {
  reverseCuts?: boolean
  reverseRooms?: boolean
  closedRooms?: boolean
  cyclicRooms?: boolean
  fractional?: boolean
  shiftAlong?: boolean
  skew?: boolean
  unequal?: boolean
  void?: boolean
  strip?: boolean
  widthMismatch?: number
}

/** A synthetic 3-4-5 survey, never inferred measurements of the user's plan. */
function fixture(options: FixtureOptions = {}): PlanGeometry {
  const first: [PlanPoint, PlanPoint] = [p(200, 200), p(260, 280)]
  const second: [PlanPoint, PlanPoint] = [p(192, 206), p(252, 286)]
  if (options.shiftAlong) {
    for (const point of second) {
      point.xCm += 0.00000006
      point.yCm += 0.00000008
    }
  }
  if (options.skew) second[1].xCm += 1
  if (options.unequal) {
    second[1].xCm += 6
    second[1].yCm += 8
  }
  let rooms: PlanGeometry['rooms'] = [
    { name: 'Interior', polygon: [first[0], first[1], p(340, 220), p(280, 140)] },
    {
      name: 'Balcony',
      spaceKind: 'balcony',
      polygon: [second[0], second[1], p(172, 346), p(112, 266)],
    },
  ]
  if (options.fractional) {
    // Translate exact decimal data; do not introduce a geometry-fitting tolerance.
    const translate = (point: PlanPoint) => p(point.xCm + 0.25, point.yCm + 0.125)
    rooms = rooms.map((room) => ({ ...room, polygon: room.polygon.map(translate) }))
    for (const cut of [first, second])
      for (const point of cut) {
        point.xCm += 0.25
        point.yCm += 0.125
      }
  }
  rooms = rooms.map((room) => {
    let polygon = structuredClone(room.polygon)
    if (options.reverseRooms) polygon.reverse()
    if (options.cyclicRooms) polygon = [...polygon.slice(1), required(polygon[0])]
    if (options.closedRooms) polygon.push(structuredClone(required(polygon[0])))
    return { ...room, polygon }
  })
  const cuts = [first, second]
  const walls: PlanGeometry['walls'] = cuts.map(([a, b], index) => ({
    id: `face-${index}`,
    kind: 'inner',
    heightCm: 270,
    start: p(a.xCm - (b.xCm - a.xCm) / 2, a.yCm - (b.yCm - a.yCm) / 2),
    end: p(b.xCm + (b.xCm - a.xCm) / 2, b.yCm + (b.yCm - a.yCm) / 2),
  }))
  const openings: PlanGeometry['openings'] = cuts.map(([a, b], index) => ({
    id: `opening-${index}`,
    type: 'balcony',
    wallId: `face-${index}`,
    offsetCm: Math.hypot(b.xCm - a.xCm, b.yCm - a.yCm) / 2,
    widthCm: Math.hypot(b.xCm - a.xCm, b.yCm - a.yCm) + (options.widthMismatch ?? 0),
    bottomCm: index === 0 ? 2 : 17,
    heightCm: 210,
  }))
  const bindings: [PlanOpeningBinding, PlanOpeningBinding] = [0, 1].map((index) => ({
    wall: structuredClone(required(walls[index])),
    opening: structuredClone(required(openings[index])),
    cut: structuredClone(required(cuts[index])),
  })) as [PlanOpeningBinding, PlanOpeningBinding]
  if (options.reverseCuts) for (const binding of bindings) binding.cut?.reverse()
  const facePair = (before: boolean): PlanWallFacePair => ({
    faces: walls.map((wall, index) => ({
      wall: structuredClone(wall),
      start: before ? wall.start : required(cuts[index])[1],
      end: before ? required(cuts[index])[0] : wall.end,
      nativeSegment: { operationIndex: before ? 10 : 11, subpathIndex: 0, segmentIndex: index },
    })) as PlanWallFacePair['faces'],
    openings: structuredClone(openings),
  })
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 500,
    heightCm: 500,
    warnings: [],
    footprint: box(0, 0, 500, 500),
    rooms,
    walls,
    openings,
    ...(options.void ? { voids: [{ id: 'portal-void', polygon: box(229, 245, 1, 1) }] } : {}),
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      openingFacePairs: [
        {
          bindings,
          jambs: [
            { operationIndex: 12, subpathIndex: 0, segmentIndex: 0 },
            { operationIndex: 12, subpathIndex: 0, segmentIndex: 1 },
          ],
        },
      ],
      sourceWallFacePairs: [facePair(true), facePair(false)],
    },
  }
  if (options.strip) {
    const crossing = [245, 246].map((y, index) => ({
      id: `cross-${index}`,
      kind: 'inner' as const,
      start: p(220, y),
      end: p(227, y),
      heightCm: 270,
    }))
    geometry.walls.push(...crossing)
    geometry.pdfCalibration?.sourceWallFacePairs?.push({
      faces: crossing.map((wall, index) => ({
        wall: structuredClone(wall),
        start: structuredClone(wall.start),
        end: structuredClone(wall.end),
        nativeSegment: { operationIndex: 14, subpathIndex: 0, segmentIndex: index },
      })) as PlanWallFacePair['faces'],
      openings: [],
    })
  }
  return resurvey(geometry)
}

function resurvey(
  geometry: PlanGeometry,
  reverseBindings = false,
  duplicateThreshold = false,
): PlanGeometry {
  const bindings = geometry.openings
    .slice(0, 2)
    .map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
      opening: { id, type, wallId, offsetCm, widthCm },
      floorId: `floor-${index}`,
    }))
  if (reverseBindings) bindings.reverse()
  const result = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'diagonal-survey',
      kind: 'finished-floor',
      zeroFloorId: 'floor-0',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: `floor-${index}`,
        room: structuredClone(room),
        surface: 'finished-floor',
        elevationCm: index === 0 ? 0 : -15,
      })),
      wallBases: geometry.walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: id === 'face-1' ? 'floor-1' : 'floor-0',
      })),
      thresholds: [
        {
          id: 'diagonal-threshold',
          elevationCm: 3,
          bindings,
        },
        ...(duplicateThreshold
          ? [
              {
                id: 'second-threshold',
                elevationCm: 3,
                bindings: geometry.openings
                  .slice(2, 4)
                  .map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
                    opening: { id, type, wallId, offsetCm, widthCm },
                    floorId: `floor-${index}`,
                  })),
              },
            ]
          : []),
      ],
      source: { kind: 'site-measurement', reference: 'Synthetic diagonal survey only' },
    },
    'test-surveyor',
    '2026-10-11T09:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

const surfaceArea = (polygon: PlanPoint[]) =>
  Math.abs(
    polygon.reduce((area, a, index) => {
      const b = required(polygon[(index + 1) % polygon.length])
      return area + a.xCm * b.yCm - b.xCm * a.yCm
    }, 0),
  ) / 2

describe('diagonal preserved threshold geometry', () => {
  it.each([
    {},
    { reverseCuts: true },
    { reverseRooms: true },
    { closedRooms: true },
    { cyclicRooms: true },
    { fractional: true },
    { reverseCuts: true, reverseRooms: true, closedRooms: true, cyclicRooms: true },
  ])('keeps a surveyed 3-4-5 portal under representation changes: %j', (options) => {
    const geometry = fixture(options)
    const before = structuredClone(geometry)
    const report = inspectPlanThresholdSurfaces(geometry)
    expect(report.issues).toEqual([])
    expect(report.surfaces).toHaveLength(1)
    expect(surfaceArea(required(report.surfaces[0]).floor)).toBe(1000)
    expect(report.surfaces[0]).toMatchObject({
      elevationCm: 3,
      floorIds: ['floor-0', 'floor-1'],
      floorElevationsCm: [0, -15],
    })
    expect(geometry).toEqual(before)
  })
  it('carries exact diagonal source ends into volume and scene, not a bounding rectangle', () => {
    const model = required(planVolume(fixture()))
    expect(model.thresholds?.[0]?.floor).toEqual([
      p(200, 200),
      p(260, 280),
      p(252, 286),
      p(192, 206),
    ])
    const scene = buildPlanScene(model)
    try {
      const threshold = required(scene.surfaces.find((surface) => surface.kind === 'threshold'))
      const positions = threshold.geometry.getAttribute('position')
      for (let index = 0; index < positions.count; index++)
        expect(positions.getY(index)).toBeCloseTo(0.03)
    } finally {
      for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
    }
  })
  it('keeps non-binary decimal coordinates without a physical collinearity epsilon', () => {
    const { verticalReference: _oldApproval, ...horizontal } = fixture()
    // Transform source data and its exact snapshots together, then explicitly resurvey.
    const geometry = JSON.parse(
      JSON.stringify(horizontal, (_key, value) => {
        if (value && typeof value === 'object' && 'xCm' in value && 'yCm' in value)
          return { xCm: value.xCm + 0.2, yCm: value.yCm + 0.1 }
        return value
      }),
    ) as PlanGeometry
    geometry.widthCm = 501
    geometry.heightCm = 501
    const report = inspectPlanThresholdSurfaces(resurvey(geometry))
    expect(report.issues).toEqual([])
    expect(required(report.surfaces[0]).floor).toEqual([
      p(200.2, 200.1),
      p(260.2, 280.1),
      p(252.2, 286.1),
      p(192.2, 206.1),
    ])
    // Only this floating-point test assertion has rounding; source gates remain exact.
    expect(surfaceArea(required(report.surfaces[0]).floor)).toBeCloseTo(1000, 9)
  })
  it('preserves representation under swapping the approved sides', () => {
    const geometry = fixture()
    const original = inspectPlanThresholdSurfaces(geometry)
    const report = inspectPlanThresholdSurfaces(resurvey(geometry, true))
    expect(report.issues).toEqual([])
    expect(surfaceArea(required(report.surfaces[0]).floor)).toBe(1000)
    expect(required(report.surfaces[0]).floor).toEqual(
      expect.arrayContaining(required(original.surfaces[0]).floor),
    )
  })
  it('accepts current exact cuts supplied by the paired printed-width proof', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const [first, second] = required(calibration.openingFacePairs?.[0]).bindings
    calibration.openingFacePairs = []
    calibration.openingWidthProofs = [
      {
        ...structuredClone(first),
        labelIndex: 77,
        sameOpeningAs: { roomSourceNumber: 2, openingId: second.opening.id },
        oppositeBinding: structuredClone(second),
      },
    ]
    const report = inspectPlanThresholdSurfaces(resurvey(geometry))
    expect(report.issues).toEqual([])
    expect(report.surfaces).toHaveLength(1)
    expect(surfaceArea(required(report.surfaces[0]).floor)).toBe(1000)
  })
  it('does not inherit saved threshold acceptance after an actual host edit', () => {
    const geometry = fixture()
    required(geometry.walls[0]).start.xCm += 0.000000001
    const report = inspectPlanThresholdSurfaces(geometry)
    expect(report.surfaces).toEqual([])
    expect(report.issues.length).toBeGreaterThan(0)
  })
  it('holds thresholds after resurvey when a different saved wall strip has become stale', () => {
    const geometry = fixture({ strip: true })
    const crossWall = required(geometry.walls.find((wall) => wall.id === 'cross-0'))
    crossWall.start.xCm += 0.000000001
    // Floor and opening owners are reapproved, but this is not a new source-wall proof.
    const report = inspectPlanThresholdSurfaces(resurvey(geometry))
    expect(report.surfaces).toEqual([])
    expect(report.issues.length).toBeGreaterThan(0)
    expect(report.issues.some((issue) => issue.message.includes('стен'))).toBe(true)
  })
  it.each(['bottomCm', 'heightCm'] as const)(
    'holds a paired known %s mismatch even though horizontal snapshots remain current',
    (field) => {
      const geometry = fixture()
      const opening = required(geometry.openings[1])
      opening[field] = field === 'bottomCm' ? 18 : 211
      const report = inspectPlanThresholdSurfaces(geometry)
      expect(report.surfaces).toEqual([])
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.issues.some((issue) => issue.openingIds?.includes('opening-1'))).toBe(true)
    },
  )
  it('holds an extra physical wall line crossing the portal even without a paired source strip', () => {
    const geometry = fixture()
    geometry.walls.push({
      id: 'unpaired-crossing',
      kind: 'inner',
      start: p(226, 245),
      end: p(236, 245),
      heightCm: 270,
    })
    const report = inspectPlanThresholdSurfaces(resurvey(geometry))
    expect(report.surfaces).toEqual([])
    expect(report.issues.length).toBeGreaterThan(0)
  })
  it('allows an extra line tangent to the portal boundary, not crossing its interior', () => {
    const geometry = fixture()
    geometry.walls.push({
      id: 'tangent-line',
      kind: 'inner',
      start: p(200, 200),
      end: p(260, 280),
      heightCm: 270,
    })
    const report = inspectPlanThresholdSurfaces(resurvey(geometry))
    expect(report.surfaces).toHaveLength(1)
    expect(report.issues).toEqual([])
  })
  it.each([
    { skew: true },
    { unequal: true },
    { shiftAlong: true },
    { void: true },
    { strip: true },
  ])('does not manufacture a surface across unproved geometry: %j', (options) => {
    const report = inspectPlanThresholdSurfaces(fixture(options))
    expect(report.surfaces).toEqual([])
    expect(report.issues.length).toBeGreaterThan(0)
  })
  it.each([
    undefined,
    null,
    [],
    [p(200, 200)],
    [p(200, 200), p(260, 280), p(230, 240)],
    [p(200, 200), undefined],
    [p(200, 200), p(Number.NaN, 280)],
  ])('holds malformed source cuts without offset reconstruction: %j', (cut) => {
    const geometry = fixture()
    const binding = required(required(geometry.pdfCalibration).openingFacePairs?.[0]).bindings[0]
    binding.cut = cut as typeof binding.cut
    expect(planOpeningEndpoints(geometry, 'opening-0')).toBeUndefined()
    const report = inspectPlanThresholdSurfaces(geometry)
    expect(report.surfaces).toEqual([])
    expect(report.issues.length).toBeGreaterThan(0)
  })
  it('holds sparse source cuts instead of throwing', () => {
    const geometry = fixture()
    const cut = [p(200, 200), p(260, 280)]
    delete cut[1]
    required(required(geometry.pdfCalibration).openingFacePairs?.[0]).bindings[0].cut = cut as [
      PlanPoint,
      PlanPoint,
    ]
    expect(planOpeningEndpoints(geometry, 'opening-0')).toBeUndefined()
  })
  it('holds conflicting source occurrences even when one valid cut remains', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const claim = structuredClone(required(calibration.openingFacePairs?.[0]).bindings[0])
    claim.cut = [p(203, 204), p(263, 284)]
    calibration.openingWidthProofs = [{ ...claim, labelIndex: 77 }]
    expect(planOpeningEndpoints(geometry, 'opening-0')).toBeUndefined()
    expect(inspectPlanThresholdSurfaces(geometry).surfaces).toEqual([])
  })
  it('holds source ends outside the actual host segment', () => {
    const geometry = fixture()
    required(required(geometry.pdfCalibration).openingFacePairs?.[0]).bindings[0].cut = [
      p(140, 120),
      p(200, 200),
    ]
    expect(planOpeningEndpoints(geometry, 'opening-0')).toBeUndefined()
  })
  it('holds both overlapping threshold claims instead of choosing one by order', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const duplicate = structuredClone(required(calibration.openingFacePairs?.[0]))
    for (const binding of duplicate.bindings) {
      binding.opening.id += '-second'
      geometry.openings.push(structuredClone(binding.opening))
    }
    calibration.openingFacePairs?.push(duplicate)
    for (const pair of calibration.sourceWallFacePairs ?? [])
      pair.openings = structuredClone(geometry.openings)
    const report = inspectPlanThresholdSurfaces(resurvey(geometry, false, true))
    expect(report.surfaces).toEqual([])
    expect(report.issues).toHaveLength(2)
  })
  it('checks only rounded nominal width while retaining exact physical ends', () => {
    const allowed = fixture({ widthMismatch: 0.19 })
    expect(planOpeningEndpoints(allowed, 'opening-0')).toEqual([p(200, 200), p(260, 280)])
    expect(inspectPlanThresholdSurfaces(allowed).surfaces).toHaveLength(1)
    const held = fixture({ widthMismatch: 0.2000001 })
    expect(planOpeningEndpoints(held, 'opening-0')).toBeUndefined()
  })
})
