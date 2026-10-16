import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
  currentWallFacePairs,
} from '@uyut/catalog/plan-opening-face-pairs'
import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanOpeningFacePair, PlanPoint, PlanWallFacePair } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { type ExteriorOpeningWitness, inspectTransferWallSolids } from './plan-transfer-wall-solids'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const point = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const box = (left: number, top: number, right: number, bottom: number) => [
  point(left, top),
  point(right, top),
  point(right, bottom),
  point(left, bottom),
]
const polygon = (points: PlanPoint[]): Polygon => [points.map(({ xCm, yCm }) => [xCm, yCm])]
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Incomplete synthetic wall fixture')
  return value
}
function firstStrip(geometry: PlanGeometry): PlanWallFacePair {
  return required(required(geometry.pdfCalibration).sourceWallFacePairs?.[0])
}
function pdfFixture(withDoor = false): PlanGeometry {
  const walls: PlanGeometry['walls'] = [
    { id: 'a', kind: 'inner', start: point(100, 0), end: point(100, 300) },
    { id: 'b', kind: 'inner', start: point(120, 0), end: point(120, 300) },
  ]
  const rooms = [
    { name: 'Lower', polygon: box(0, 0, 100, 300) },
    { name: 'Upper', polygon: box(120, 0, 220, 300) },
  ]
  const openings: PlanGeometry['openings'] = withDoor
    ? walls.map((wall) => ({
        id: `door-${wall.id}`,
        wallId: wall.id,
        type: 'door',
        offsetCm: 100,
        widthCm: 100,
        bottomCm: 0,
        heightCm: 220,
      }))
    : []
  const strip = (start: number, end: number): PlanWallFacePair => ({
    faces: walls.map((wall, index) => ({
      wall: structuredClone(wall),
      start: point(wall.start.xCm, start),
      end: point(wall.end.xCm, end),
      nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: index },
    })) as PlanWallFacePair['faces'],
    openings: structuredClone(openings),
  })
  return {
    version: 1,
    status: 'confirmed',
    widthCm: 220,
    heightCm: 300,
    rooms,
    walls,
    openings,
    warnings: [],
    footprint: box(0, 0, 220, 300),
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      sourceWallFacePairs: withDoor ? [strip(0, 100), strip(200, 300)] : [strip(0, 300)],
      openingFacePairs: withDoor
        ? [
            {
              bindings: walls.map((wall, index) => ({
                wall: structuredClone(wall),
                opening: structuredClone(required(openings[index])),
                cut: [point(wall.start.xCm, 100), point(wall.start.xCm, 200)],
              })) as PlanOpeningFacePair['bindings'],
              jambs: [
                { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
                { operationIndex: 2, subpathIndex: 0, segmentIndex: 1 },
              ],
            },
          ]
        : [],
    },
  }
}
function surveyed(): PlanGeometry {
  const geometry = pdfFixture(true)
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'survey',
      kind: 'finished-floor',
      zeroFloorId: 'floor-0',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: `floor-${index}`,
        room,
        surface: 'finished-floor',
        elevationCm: 0,
      })),
      ceilings: geometry.rooms.map((_room, index) => ({
        id: `ceil-${index}`,
        floorId: `floor-${index}`,
        elevationCm: 270,
      })),
      wallBases: geometry.walls.map(({ id, kind, start, end }, index) => ({
        wall: { id, kind, start, end },
        floorId: `floor-${index}`,
      })),
      thresholds: [
        {
          id: 'threshold',
          elevationCm: 0,
          bindings: geometry.openings.map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
            opening: { id, type, wallId, offsetCm, widthCm },
            floorId: `floor-${index}`,
          })),
        },
      ],
      source: { kind: 'site-measurement', reference: 'Synthetic wall occupancy survey' },
    },
    'test',
    '2026-10-11T12:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}

describe('conservative transfer wall solids', () => {
  it('invalidates source proofs when duplicate floor snapshots hide a changed room', () => {
    const geometry = pdfFixture(true)
    const calibration = required(geometry.pdfCalibration)
    const pair = required(calibration.openingFacePairs?.[0])
    calibration.openingWidthProofs = [{ ...structuredClone(pair.bindings[0]), labelIndex: 0 }]
    const first = required(geometry.rooms[0])
    calibration.wallFaceRoomPolygons = [
      structuredClone(first.polygon),
      structuredClone(first.polygon),
    ]
    expect(currentOpeningFacePairs(geometry)).toEqual([])
    expect(currentOpeningWidthProofs(geometry)).toEqual([])
    expect(currentWallFacePairs(geometry)).toEqual([])
    expect(inspectTransferWallSolids(geometry).error).toBeDefined()
  })

  it('keeps source proofs when distinct floor snapshots are reordered', () => {
    const geometry = pdfFixture(true)
    required(geometry.pdfCalibration).wallFaceRoomPolygons?.reverse()
    expect(currentOpeningFacePairs(geometry)).toHaveLength(1)
    expect(currentWallFacePairs(geometry)).toHaveLength(2)
  })

  it('matches repeated floor snapshots one-to-one', () => {
    const geometry = pdfFixture(true)
    const first = required(geometry.rooms[0])
    geometry.rooms[1] = structuredClone(first)
    required(geometry.pdfCalibration).wallFaceRoomPolygons = geometry.rooms.map(({ polygon }) =>
      structuredClone(polygon),
    )
    expect(currentOpeningFacePairs(geometry)).toHaveLength(1)
    required(geometry.rooms[1]).polygon[0] = point(-1, -1)
    expect(currentOpeningFacePairs(geometry)).toEqual([])
    expect(currentWallFacePairs(geometry)).toEqual([])
  })

  it.each(['snapshot', 'source-cut'] as const)(
    'an explicit raw entry witness cannot hide a stale non-entry %s',
    (mutation) => {
      let geometry = surveyed()
      const calibration = required(geometry.pdfCalibration)
      const internal = required(required(calibration.openingFacePairs)[0])
      const extra: PlanOpeningFacePair = structuredClone(internal)
      for (const [index, binding] of extra.bindings.entries()) {
        binding.opening.id = `raw-entry-${index}`
        binding.opening.offsetCm = 220
        binding.opening.widthCm = 30
        binding.cut = [point(binding.wall.start.xCm, 220), point(binding.wall.start.xCm, 250)]
        geometry.openings.push(structuredClone(binding.opening))
      }
      calibration.sourceOpeningFacePairs = [structuredClone(internal), extra]
      calibration.openingWidthProofs = extra.bindings.map((binding, index) => ({
        ...structuredClone(binding),
        labelIndex: index,
      }))
      const originalStrip = firstStrip(geometry)
      calibration.sourceWallFacePairs = [
        [0, 100],
        [200, 220],
        [250, 300],
      ].map(([start, end]) => ({
        ...structuredClone(originalStrip),
        faces: originalStrip.faces.map((face) => ({
          ...structuredClone(face),
          start: point(face.start.xCm, required(start)),
          end: point(face.end.xCm, required(end)),
        })) as PlanWallFacePair['faces'],
        openings: structuredClone(geometry.openings),
      }))
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
          wallBases: reference.wallBases,
          thresholds: reference.thresholds,
          source: reference.source,
        },
        'test',
        '2026-10-11T16:00:00.000Z',
      )
      if (!accepted.ok) throw new Error(accepted.error)
      geometry = accepted.geometry
      const currentCalibration = required(geometry.pdfCalibration)
      const raw = required(currentCalibration.sourceOpeningFacePairs)
      const witness = (): ExteriorOpeningWitness => ({
        pair: required(raw[1]),
        geometryKey: JSON.stringify(geometry),
        referenceKey: verticalReferenceReviewKey(required(geometry.verticalReference)),
        outerOpeningId: 'raw-entry-1',
        outerBottomElevationCm: 0,
        outerTopElevationCm: 220,
        thresholdElevationCm: 0,
      })
      expect(inspectTransferWallSolids(geometry, witness()).error).toBeUndefined()
      const stale = required(raw[0]).bindings[0]
      if (mutation === 'snapshot') stale.opening.widthCm = 101
      else required(stale.cut)[1].yCm = 201
      // Refreshing both request keys cannot turn unrelated stale source evidence current.
      const held = inspectTransferWallSolids(geometry, witness())
      expect(held.error).toBeDefined()
      expect(held.solids).toEqual([])
      expect(held.openings).toEqual([])
    },
  )
  it.each(['height', 'bottom', 'wall-head'] as const)(
    'holds invalid defined vertical metadata instead of emitting clearance terms: %s',
    (field) => {
      const geometry = surveyed()
      const opening = geometry.openings[0]
      const wall = geometry.walls[0]
      if (!opening || !wall) throw new Error('Incomplete vertical wall fixture')
      if (field === 'height') opening.heightCm = 700
      if (field === 'bottom') opening.bottomCm = 701
      if (field === 'wall-head') wall.heightCm = 100
      const result = inspectTransferWallSolids(geometry)
      expect(result.error).toBeTruthy()
      expect(result.solids).toEqual([])
      expect(result.openings).toEqual([])
    },
  )
  it('bounds source relation work before checking potentially quadratic host coverage', () => {
    const geometry = pdfFixture()
    const calibration = required(geometry.pdfCalibration)
    calibration.sourceWallFacePairs = Array.from({ length: 2001 }, () => firstStrip(geometry))
    expect(inspectTransferWallSolids(geometry)).toMatchObject({
      error: expect.stringContaining('объём'),
      solids: [],
      openings: [],
    })
  })
  it('uses actual PDF strips without giving a face centreline thickness', () => {
    const geometry = pdfFixture()
    const before = structuredClone(geometry)
    const result = inspectTransferWallSolids(geometry)
    expect(result.error).toBeUndefined()
    expect(polygonClipping.union(required(result.solids[0]), ...result.solids.slice(1))).toEqual(
      polygonClipping.union(polygon(box(100, 0, 120, 300))),
    )
    expect(result.openings).toEqual([])
    expect(geometry).toEqual(before)
  })
  it('keeps paired cuts separate and blocked until both heights and threshold are known', () => {
    const result = inspectTransferWallSolids(pdfFixture(true))
    expect(result.error).toBeUndefined()
    expect(result.solids).toHaveLength(2)
    expect(result.openings).toHaveLength(1)
    expect(result.openings[0]).toMatchObject({
      openingIds: ['door-a', 'door-b'],
      bottomTerms: [],
      topTerms: [],
    })
    expect(polygonClipping.union(required(result.openings[0]).polygon)).toEqual(
      polygonClipping.union(polygon(box(100, 100, 120, 200))),
    )
  })
  it('provides exact unevaluated height sums and only a current threshold', () => {
    const result = inspectTransferWallSolids(surveyed())
    expect(result.error).toBeUndefined()
    expect(result.openings[0]).toMatchObject({
      bottomTerms: [
        [0, 0],
        [0, 0],
      ],
      topTerms: [
        [0, 0, 220],
        [0, 0, 220],
      ],
      thresholdElevationCm: 0,
    })
  })
  it('holds the aperture when one head is unknown', () => {
    const geometry = surveyed()
    delete required(geometry.openings[1]).heightCm
    const result = inspectTransferWallSolids(geometry)
    expect(result.error).toBeUndefined()
    expect(result.openings[0]?.topTerms).toEqual([])
  })
  it('does not invalidate physical strips for legitimate array reordering', () => {
    const geometry = pdfFixture(true)
    geometry.walls.reverse()
    geometry.rooms.reverse()
    geometry.openings.reverse()
    expect(inspectTransferWallSolids(geometry).error).toBeUndefined()
  })
  it('accepts oppositely directed source intervals without creating a bow tie', () => {
    const geometry = pdfFixture()
    const face = firstStrip(geometry).faces[1]
    const originalStart = face.start
    face.start = face.end
    face.end = originalStart
    const result = inspectTransferWallSolids(geometry)
    expect(polygonClipping.union(required(result.solids[0]), ...result.solids.slice(1))).toEqual(
      polygonClipping.union(polygon(box(100, 0, 120, 300))),
    )
  })
  it.each(['host', 'cut', 'room', 'added-cut'] as const)(
    'holds stale source evidence after %s edit',
    (mode) => {
      const geometry = pdfFixture(true)
      if (mode === 'host') required(geometry.walls[0]).end.yCm += 1
      if (mode === 'cut') required(geometry.openings[0]).widthCm += 1
      if (mode === 'room') required(required(geometry.rooms[0]).polygon[0]).xCm += 1
      if (mode === 'added-cut')
        geometry.openings.push({ ...required(geometry.openings[0]), id: 'extra' })
      expect(inspectTransferWallSolids(geometry)).toMatchObject({
        error: expect.any(String),
        solids: [],
        openings: [],
      })
    },
  )
  it('holds an unknown unpaired PDF face even when it has measured thickness', () => {
    const geometry = pdfFixture()
    geometry.walls.push({
      id: 'unknown',
      kind: 'outer',
      start: point(0, 0),
      end: point(50, 0),
      measuredThicknessCm: 20,
    })
    expect(inspectTransferWallSolids(geometry).error).toBeDefined()
  })
  it('holds partially covered source hosts and off-host strip endpoints', () => {
    const geometry = pdfFixture()
    firstStrip(geometry).faces[0].end.yCm = 299
    expect(inspectTransferWallSolids(geometry).error).toBeDefined()
    firstStrip(geometry).faces[0].end = point(101, 300)
    expect(inspectTransferWallSolids(geometry).error).toBeDefined()
  })
  it('holds zero-area, crossed, duplicate-owner and nonfinite strips', () => {
    for (const mode of ['collapsed', 'crossed', 'duplicate', 'nonfinite']) {
      const geometry = pdfFixture()
      const pair = firstStrip(geometry)
      if (mode === 'collapsed') pair.faces[1] = structuredClone(pair.faces[0])
      if (mode === 'crossed') pair.faces[1].end = point(90, 300)
      if (mode === 'duplicate') required(geometry.walls[1]).id = 'a'
      if (mode === 'nonfinite') pair.faces[0].start.xCm = Number.NaN
      expect(inspectTransferWallSolids(geometry).error).toBeDefined()
    }
  })
  it('conservatively covers thick T joints and never cuts an axis doorway', () => {
    const geometry = pdfFixture()
    delete geometry.pdfCalibration
    geometry.walls = [
      {
        id: 'h',
        kind: 'inner',
        start: point(0, 100),
        end: point(200, 100),
        measuredThicknessCm: 20,
      },
      {
        id: 'v',
        kind: 'inner',
        start: point(100, 100),
        end: point(100, 200),
        measuredThicknessCm: 20,
      },
    ]
    const result = inspectTransferWallSolids(geometry)
    expect(result.error).toBeUndefined()
    expect(polygonClipping.difference(polygon(box(90, 90, 110, 110)), ...result.solids)).toEqual([])
    expect(result.openings).toEqual([])
  })
  it.each([undefined, 0, -1, Number.NaN, Infinity, 101])(
    'holds missing or invalid axis thickness %s',
    (thickness) => {
      const geometry = pdfFixture()
      delete geometry.pdfCalibration
      required(geometry.walls[0]).measuredThicknessCm = thickness
      required(geometry.walls[1]).measuredThicknessCm = 20
      expect(inspectTransferWallSolids(geometry).error).toBeDefined()
    },
  )
})
