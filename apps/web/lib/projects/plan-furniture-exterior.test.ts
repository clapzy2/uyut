import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint, PlanWallFacePair } from '@uyut/db'
import { describe, expect, it, vi } from 'vitest'
import { inspectFurnitureDoorLeaves } from './plan-furniture-door-leaves'
import {
  furnitureExteriorOpeningWitness,
  inspectFurnitureExteriorIngress,
} from './plan-furniture-exterior'
import * as wallSolids from './plan-transfer-wall-solids'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const p = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const box = (left: number, top: number, right: number, bottom: number) => [
  p(left, top),
  p(right, top),
  p(right, bottom),
  p(left, bottom),
]
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Incomplete synthetic exterior fixture')
  return value
}

/** Explicit source wall thickness and a measured exterior landing, not extended apartment floor. */
function fixture(reverseOuter = false): PlanGeometry {
  const room = { name: 'Lower room', polygon: box(0, 0, 250, 300) }
  const walls: PlanGeometry['walls'] = [
    { id: 'entry-front', kind: 'outer', start: p(0, 0), end: p(250, 0) },
    {
      id: 'entry-back',
      kind: 'outer',
      start: p(reverseOuter ? 250 : 0, -20),
      end: p(reverseOuter ? 0 : 250, -20),
    },
  ]
  const entry: PlanGeometry['openings'][number] = {
    id: 'entry',
    type: 'door',
    wallId: 'entry-front',
    offsetCm: 70,
    widthCm: 110,
    bottomCm: 0,
    heightCm: 220,
    clearance: { side: 'left', depthCm: 150, shape: 'rectangle' },
  }
  const pair: PlanWallFacePair = {
    faces: walls.map((wall, index) => ({
      wall: structuredClone(wall),
      start: p(0, index ? -20 : 0),
      end: p(250, index ? -20 : 0),
      nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: index },
    })) as PlanWallFacePair['faces'],
    openings: [structuredClone(entry)],
  }
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 250,
    heightCm: 300,
    warnings: [],
    rooms: [room],
    walls,
    openings: [entry],
    footprint: box(0, 0, 250, 300),
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
      wallFaceRoomPolygons: [structuredClone(room.polygon)],
      sourceWallFacePairs: [pair],
      openingWidthProofs: [
        {
          opening: structuredClone(entry),
          wall: structuredClone(required(walls[0])),
          cut: [p(70, 0), p(180, 0)],
          labelIndex: 0,
        },
      ],
    },
  }
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'exterior-reference',
      kind: 'finished-floor',
      zeroFloorId: 'lower',
      acknowledged: true,
      floors: [{ id: 'lower', room, surface: 'finished-floor', elevationCm: 0 }],
      ceilings: [{ id: 'lower-head', floorId: 'lower', elevationCm: 360 }],
      wallBases: walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: 'lower',
      })),
      thresholds: [],
      source: { kind: 'site-measurement', reference: 'Synthetic exterior route survey' },
    },
    'test-surveyor',
    '2026-10-11T15:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}

function survey(geometry: PlanGeometry) {
  return {
    version: 1 as const,
    geometryKey: JSON.stringify(geometry),
    referenceKey: verticalReferenceReviewKey(required(geometry.verticalReference)),
    source: {
      kind: 'site-measurement' as const,
      reference: 'Synthetic exterior landing, gate and ceilings',
    },
    acknowledged: true as const,
    openingId: 'entry',
    outerWallId: 'entry-back',
    outerCut: [p(70, -20), p(180, -20)] as [PlanPoint, PlanPoint],
    outerBottomElevationCm: 0,
    outerTopElevationCm: 220,
    corridorCeilingElevationCm: 220,
    thresholdElevationCm: 5,
    carryElevationCm: 10,
    outside: {
      polygon: box(0, -320, 250, -20),
      start: p(125, -150),
      elevationCm: -10,
      ceilingElevationCm: 360,
    },
  }
}
const body = { widthCm: 40, depthCm: 60, heightCm: 170 }
const inside = { ...p(125, 75), zCm: 0 }
function leaves(geometry: PlanGeometry, mode: 'fixed-open' | 'moving' = 'fixed-open', angle = 90) {
  const result = inspectFurnitureDoorLeaves(geometry, {
    geometryKey: JSON.stringify(geometry),
    referenceKey: verticalReferenceReviewKey(required(geometry.verticalReference)),
    source: { kind: 'site-measurement', reference: 'Synthetic entry leaf hardware and pose' },
    acknowledged: true,
    leaves: [
      {
        openingId: 'entry',
        hinge: p(70, 0),
        closedTip: p(180, 0),
        thicknessCm: 3,
        bottomElevationCm: 0,
        topElevationCm: 210,
        openAngleDeg: angle,
        mode,
      },
    ],
  })
  if (result.error) throw new Error(result.error)
  return result.volumes
}
function inspect(
  geometry: PlanGeometry,
  input: unknown = survey(geometry),
  leafMode: 'fixed-open' | 'moving' = 'fixed-open',
  angle = 90,
) {
  return inspectFurnitureExteriorIngress(
    geometry,
    input,
    body,
    inside,
    leaves(geometry, leafMode, angle),
    6000,
  )
}

function refreshReference(geometry: PlanGeometry) {
  const reference = required(geometry.verticalReference)
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: reference.id,
      kind: reference.kind,
      zeroFloorId: reference.zeroFloorId,
      acknowledged: true,
      floors: reference.floors,
      ceilings: reference.ceilings,
      wallBases: geometry.walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: 'lower',
      })),
      thresholds: reference.thresholds,
      source: reference.source,
    },
    'test-surveyor',
    '2026-10-11T15:01:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}

/** Raw source pair without assigning the exterior landing to an apartment room. */
function pairedFixture() {
  let geometry = fixture()
  const inner = required(geometry.openings[0])
  const outerWall = required(geometry.walls[1])
  const outer = { ...structuredClone(inner), id: 'outer-entry', wallId: outerWall.id }
  geometry.openings.push(outer)
  const calibration = required(geometry.pdfCalibration)
  const innerProof = required(required(calibration.openingWidthProofs)[0])
  const oppositeBinding = {
    opening: structuredClone(outer),
    wall: structuredClone(outerWall),
    cut: [p(70, -20), p(180, -20)] as [PlanPoint, PlanPoint],
  }
  innerProof.oppositeBinding = oppositeBinding
  // No sameOpeningAs projected-room relation: the outside floor is explicitly
  // surveyed by exterior ingress, never added to the apartment footprint.
  calibration.sourceOpeningFacePairs = [
    {
      bindings: [structuredClone(innerProof), structuredClone(oppositeBinding)],
      jambs: [
        { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
        { operationIndex: 2, subpathIndex: 0, segmentIndex: 1 },
      ],
    },
  ]
  const full = required(required(calibration.sourceWallFacePairs)[0])
  calibration.sourceWallFacePairs = [
    [0, 70],
    [180, 250],
  ].map(([left, right], index) => ({
    faces: full.faces.map((face) => ({
      ...structuredClone(face),
      start: p(required(left), face.start.yCm),
      end: p(required(right), face.end.yCm),
      nativeSegment: { ...face.nativeSegment, operationIndex: 3 + index },
    })) as PlanWallFacePair['faces'],
    openings: structuredClone(geometry.openings),
  }))
  geometry = refreshReference(geometry)
  return geometry
}

describe('measured exterior furniture ingress', () => {
  it('joins the outside floor, measured threshold and inside floor without a height jump', () => {
    const geometry = fixture()
    const result = inspect(geometry)
    expect(result.error).toBeUndefined()
    const points = required(result.points)
    expect(points[0]).toMatchObject({ xCm: 125, yCm: -150, zCm: -10 })
    expect(points.at(-1)).toMatchObject(inside)
    expect(points.some(({ zCm }) => zCm === 10)).toBe(true)
    expect(result.checkedNodes).toBeLessThanOrEqual(6000)
    for (let index = 1; index < points.length; index++) {
      const before = required(points[index - 1]),
        after = required(points[index])
      expect(
        before.zCm === after.zCm || (before.xCm === after.xCm && before.yCm === after.yCm),
      ).toBe(true)
    }
  })

  it('accepts a reversed source wall direction and reversed outer cut order', () => {
    const geometry = fixture(true)
    const input = survey(geometry)
    input.outerCut.reverse()
    expect(inspect(geometry, input).error).toBeUndefined()
  })

  it('joins a real paired source aperture between split wall strips without inventing its threshold', () => {
    const geometry = pairedFixture()
    expect(wallSolids.inspectTransferWallSolids(geometry).error).toBeDefined()
    const witness = required(furnitureExteriorOpeningWitness(geometry, survey(geometry)))
    const model = wallSolids.inspectTransferWallSolids(geometry, witness)
    expect(model.error).toBeUndefined()
    expect(model.solids).toHaveLength(2)
    expect(model.openings).toHaveLength(1)
    expect(model.openings[0]?.bottomTerms).toEqual([[0, 0], [0]])
    expect(model.openings[0]?.topTerms).toEqual([[0, 0, 220], [220]])
    expect(model.openings[0]?.thresholdElevationCm).toBe(5)
    expect(leaves(geometry)).toHaveLength(1)
    const result = inspect(geometry)
    expect(result.error).toBeUndefined()
    expect(result.points?.[0]?.zCm).toBe(-10)
    expect(result.points?.at(-1)).toMatchObject(inside)
  })

  it('does not loosen a known outer head or lower edge through the exterior witness', () => {
    const geometry = pairedFixture()
    const input = survey(geometry)
    input.outerTopElevationCm = 220.001
    expect(inspect(geometry, input).error).toBeDefined()
    input.outerTopElevationCm = 220
    input.outerBottomElevationCm = -0.001
    expect(inspect(geometry, input).error).toBeDefined()
    const witness = required(furnitureExteriorOpeningWitness(geometry, survey(geometry)))
    witness.geometryKey = 'stale'
    expect(wallSolids.inspectTransferWallSolids(geometry, witness).error).toBeDefined()
  })

  it('holds a shifted exterior cut, unknown opposite head and stale paired host', () => {
    const geometry = pairedFixture()
    const input = survey(geometry)
    input.outerCut = [p(71, -20), p(181, -20)]
    expect(inspect(geometry, input).error).toBeDefined()
    const measuredLeaves = leaves(geometry)
    delete required(geometry.openings[1]).heightCm
    expect(
      inspectFurnitureExteriorIngress(
        geometry,
        survey(geometry),
        body,
        inside,
        measuredLeaves,
        6000,
      ).error,
    ).toBeDefined()
    const stale = pairedFixture()
    required(stale.walls[1]).start = p(1, -20)
    expect(
      inspectFurnitureExteriorIngress(stale, survey(stale), body, inside, measuredLeaves, 6000)
        .error,
    ).toBeDefined()
  })

  it('uses the actual outer and corridor heads, including their exact decimal boundary', () => {
    const geometry = fixture()
    const input = survey(geometry)
    input.outerTopElevationCm = 180
    input.corridorCeilingElevationCm = 180
    input.outside.ceilingElevationCm = 180
    expect(inspect(geometry, input).error).toBeUndefined()
    input.outerTopElevationCm = 179.99999999999997
    expect(inspect(geometry, input).error).toBeDefined()
  })

  it.each([
    { name: 'complete two-face aperture', expectedPass: true, mutation: {} },
    { name: 'unknown opposite bottom', expectedPass: false, mutation: { bottomTerms: [[0]] } },
    { name: 'unknown opposite head', expectedPass: false, mutation: { topTerms: [[220]] } },
    {
      name: 'unknown threshold',
      expectedPass: false,
      mutation: { thresholdElevationCm: undefined },
    },
    { name: 'low opposite head', expectedPass: false, mutation: { topTerms: [[220], [179.999]] } },
    {
      name: 'raised opposite bottom',
      expectedPass: false,
      mutation: { bottomTerms: [[0], [10.001]] },
    },
    { name: 'high threshold', expectedPass: false, mutation: { thresholdElevationCm: 10.001 } },
  ])(
    'gates every other interior aperture during exterior search: $name',
    ({ expectedPass, mutation }) => {
      const geometry = fixture()
      const model = wallSolids.inspectTransferWallSolids(geometry)
      expect(model.error).toBeUndefined()
      // Isolate the physical-model adapter contract: the added full-width
      // interior hole is crossed by every route to the otherwise valid endpoint.
      // This is not a source recognition or geometry-construction fixture.
      const opening: wallSolids.TransferWallOpening = {
        openingIds: ['interior-first', 'interior-second'],
        polygon: [box(0, 20, 250, 40).map(({ xCm, yCm }) => [xCm, yCm])],
        bottomTerms: [[0], [0]],
        topTerms: [[220], [220]],
        thresholdElevationCm: 0,
        ...mutation,
      }
      const mock = vi.spyOn(wallSolids, 'inspectTransferWallSolids').mockReturnValue({
        ...model,
        openings: [...model.openings, opening],
      })
      try {
        const result = inspect(geometry)
        expect(result.error === undefined).toBe(expectedPass)
        expect(Boolean(result.points)).toBe(expectedPass)
      } finally {
        mock.mockRestore()
      }
    },
  )

  it.each(['fixed-open', 'moving'] as const)('closed or moving door volumes block (%s)', (mode) => {
    const geometry = fixture()
    expect(
      inspect(geometry, survey(geometry), mode, mode === 'fixed-open' ? 0 : 90).error,
    ).toBeDefined()
  })

  it.each([
    { outerTopElevationCm: 179.999 },
    { corridorCeilingElevationCm: 179.999 },
    { outerBottomElevationCm: 10.001 },
    { carryElevationCm: 4.999 },
    { thresholdElevationCm: -0.001 },
    { outerTopElevationCm: 0 },
    { outerWallId: 'entry-front' },
    { outerWallId: 'unknown' },
    { openingId: 'unknown' },
    { outerCut: [p(70, -20), p(181, -20)] },
    { outerCut: [p(71, -20), p(181, -20)] },
    { outerCut: [p(70, -19.999), p(180, -19.999)] },
    { acknowledged: false },
  ])(
    'holds incomplete or mismatching exterior data $outerTopElevationCm $outerWallId $openingId',
    (mutation) => {
      const geometry = fixture()
      expect(inspect(geometry, { ...survey(geometry), ...mutation }).error).toBeDefined()
    },
  )

  it.each(['geometryKey', 'referenceKey'] as const)('holds stale %s', (key) => {
    const geometry = fixture()
    expect(inspect(geometry, { ...survey(geometry), [key]: 'stale' }).error).toBeDefined()
  })

  it.each([null, undefined, {}, { acknowledged: true }])(
    'does not infer missing exterior measurements (%j)',
    (input) => {
      const geometry = fixture()
      // Call directly so undefined is not replaced by the test convenience default.
      expect(
        inspectFurnitureExteriorIngress(geometry, input, body, inside, leaves(geometry), 6000)
          .error,
      ).toBeDefined()
    },
  )

  it.each([
    { polygon: box(0, -320, 250, 1) },
    { polygon: box(0, -320, 250, -21) },
    { polygon: [p(0, -320), p(250, -20), p(0, -20), p(250, -320)] },
  ])('holds overlap, disconnected boundaries and self-crossing floor rings', ({ polygon }) => {
    const geometry = fixture()
    const input = survey(geometry)
    input.outside.polygon = polygon
    expect(inspect(geometry, input).error).toBeDefined()
  })

  it('does not remove an unrelated coincident physical wall when cutting the selected door', () => {
    let geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const original = required(required(calibration.sourceWallFacePairs)[0])
    const unrelated = structuredClone(original)
    unrelated.openings = []
    for (const [index, face] of unrelated.faces.entries()) {
      face.wall.id = `unrelated-${index}`
      face.nativeSegment.operationIndex = 3
      geometry.walls.push(structuredClone(face.wall))
    }
    required(calibration.sourceWallFacePairs).push(unrelated)
    geometry = refreshReference(geometry)
    expect(inspect(geometry).error).toBeDefined()
  })

  it('holds unknown gate head and unmeasured source wall thickness', () => {
    const geometry = fixture()
    const input = survey(geometry)
    const { outerTopElevationCm: _head, ...missingHead } = input
    expect(inspect(geometry, missingHead).error).toBeDefined()
    delete required(geometry.pdfCalibration).sourceWallFacePairs
    expect(inspect(geometry).error).toBeDefined()
  })

  it('requires full endpoint bodies on measured floors and a shared bounded search budget', () => {
    const geometry = fixture()
    const input = survey(geometry)
    input.outside.start = p(10, -150)
    expect(inspect(geometry, input).error).toBeDefined()
    expect(
      inspectFurnitureExteriorIngress(
        geometry,
        survey(geometry),
        body,
        { ...inside, zCm: 1 },
        leaves(geometry),
        6000,
      ).error,
    ).toBeDefined()
    for (const budget of [0, 2, 6001, NaN, 100.5])
      expect(
        inspectFurnitureExteriorIngress(
          geometry,
          survey(geometry),
          body,
          inside,
          leaves(geometry),
          budget,
        ).error,
      ).toBeDefined()
    expect(
      inspectFurnitureExteriorIngress(geometry, survey(geometry), body, inside, [], 6000).error,
    ).toBeDefined()
  })
})
