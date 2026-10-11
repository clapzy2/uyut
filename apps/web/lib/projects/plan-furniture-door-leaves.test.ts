import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  doorLeafBlocks,
  type FurnitureDoorLeafSurvey,
  inspectFurnitureDoorLeaves,
} from './plan-furniture-door-leaves'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const p = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Incomplete synthetic leaf fixture')
  return value
}
const box = (left: number, top: number, right: number, bottom: number) => [
  p(left, top),
  p(right, top),
  p(right, bottom),
  p(left, bottom),
]

/** Synthetic source cuts and explicitly measured single leaves, not inferred field measurements. */
function fixture(paired = false, window = false): PlanGeometry {
  const rooms = [
    { name: 'Room', polygon: box(0, 0, 300, 300) },
    ...(paired ? [{ name: 'Next room', polygon: box(320, 0, 620, 300) }] : []),
  ]
  const walls: PlanGeometry['walls'] = [
    { id: 'entry-wall', kind: 'outer', start: p(0, 0), end: p(300, 0), heightCm: 270 },
    ...(paired
      ? [
          {
            id: 'first-wall',
            kind: 'inner' as const,
            start: p(300, 0),
            end: p(300, 300),
            heightCm: 270,
          },
          {
            id: 'second-wall',
            kind: 'inner' as const,
            start: p(320, 0),
            end: p(320, 300),
            heightCm: 270,
          },
        ]
      : []),
  ]
  const openings: PlanGeometry['openings'] = walls.map((wall, index) => ({
    id: index === 0 ? 'entry' : index === 1 ? 'first' : 'second',
    type: window ? 'window' : 'door',
    wallId: wall.id,
    offsetCm: 100,
    widthCm: 100,
    bottomCm: 0,
    heightCm: 220,
  }))
  const bindings = openings.map((opening, index) => ({
    opening: structuredClone(opening),
    wall: structuredClone(required(walls[index])),
    cut: (index === 0
      ? [p(100, 0), p(200, 0)]
      : [p(index === 1 ? 300 : 320, 100), p(index === 1 ? 300 : 320, 200)]) as [
      PlanPoint,
      PlanPoint,
    ],
  }))
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: paired ? 620 : 300,
    heightCm: 300,
    warnings: [],
    rooms,
    walls,
    openings,
    footprint: box(0, 0, paired ? 620 : 300, 300),
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map(({ polygon }) => polygon)),
      openingWidthProofs: [{ ...required(bindings[0]), labelIndex: 0 }],
      openingFacePairs: paired
        ? [
            {
              bindings: [required(bindings[1]), required(bindings[2])],
              jambs: [
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
              ],
            },
          ]
        : [],
    },
  }
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'door-survey',
      kind: 'finished-floor',
      zeroFloorId: 'floor-0',
      acknowledged: true,
      floors: rooms.map((room, index) => ({
        id: `floor-${index}`,
        room,
        surface: 'finished-floor',
        elevationCm: 0,
      })),
      ceilings: rooms.map((_room, index) => ({
        id: `ceiling-${index}`,
        floorId: `floor-${index}`,
        elevationCm: 270,
      })),
      wallBases: walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: id === 'second-wall' ? 'floor-1' : 'floor-0',
      })),
      thresholds: paired
        ? [
            {
              id: 'threshold',
              elevationCm: 0,
              bindings: openings.slice(1).map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
                opening: { id, type, wallId, offsetCm, widthCm },
                floorId: `floor-${index}`,
              })),
            },
          ]
        : [],
      source: { kind: 'site-measurement', reference: 'Synthetic measured door fixture' },
    },
    'test-surveyor',
    '2026-10-11T14:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}

function survey(geometry: PlanGeometry): FurnitureDoorLeafSurvey {
  if (!geometry.verticalReference) throw new Error('Missing fixture reference')
  return {
    geometryKey: JSON.stringify(geometry),
    referenceKey: verticalReferenceReviewKey(geometry.verticalReference),
    source: {
      kind: 'site-measurement',
      reference: 'Synthetic leaf widths, hinges, angles and heights',
    },
    acknowledged: true,
    leaves: [
      {
        openingId: 'entry',
        hinge: p(100, 0),
        closedTip: p(200, 0),
        thicknessCm: 4,
        bottomElevationCm: 0,
        topElevationCm: 210,
        openAngleDeg: 90,
        mode: 'fixed-open',
      },
      ...(geometry.openings.length > 1
        ? [
            {
              openingId: 'first',
              hinge: p(300, 100),
              closedTip: p(300, 200),
              thicknessCm: 4,
              bottomElevationCm: 0,
              topElevationCm: 210,
              openAngleDeg: 90,
              mode: 'fixed-open' as const,
            },
          ]
        : []),
    ],
  }
}

describe('measured furniture door leaf volumes', () => {
  it('distinguishes an explicitly fixed open leaf from the closed leaf', () => {
    const geometry = fixture()
    const input = survey(geometry)
    const opened = inspectFurnitureDoorLeaves(geometry, input)
    expect(opened.error).toBeUndefined()
    expect(doorLeafBlocks(opened.volumes, [130, -1, 170, 1], 0, 180)).toBe(false)
    required(input.leaves[0]).openAngleDeg = 0
    const closed = inspectFurnitureDoorLeaves(geometry, input)
    expect(doorLeafBlocks(closed.volumes, [130, -1, 170, 1], 0, 180)).toBe(true)
  })

  it('encloses arbitrary signed fixed poses', () => {
    const geometry = fixture()
    const input = survey(geometry)
    for (const angle of [-180, -137.5, -90, -35.25, 0, 23.125, 90, 145.75, 180]) {
      required(input.leaves[0]).openAngleDeg = angle
      const result = inspectFurnitureDoorLeaves(geometry, input)
      expect(result.error).toBeUndefined()
      const bounds = required(result.volumes[0]).bounds
      const rad = (angle * Math.PI) / 180
      const tipX = 100 + 100 * Math.cos(rad)
      const tipY = 100 * Math.sin(rad)
      expect(bounds[0]).toBeLessThanOrEqual(Math.min(100, tipX))
      expect(bounds[1]).toBeLessThanOrEqual(Math.min(0, tipY))
      expect(bounds[2]).toBeGreaterThanOrEqual(Math.max(100, tipX))
      expect(bounds[3]).toBeGreaterThanOrEqual(Math.max(0, tipY))
    }
  })

  it('moving mode covers intermediate and closed poses even when final pose is open', () => {
    const geometry = fixture()
    const input = survey(geometry)
    required(input.leaves[0]).mode = 'moving'
    const result = inspectFurnitureDoorLeaves(geometry, input)
    expect(result.error).toBeUndefined()
    expect(doorLeafBlocks(result.volumes, [130, -1, 170, 1], 0, 180)).toBe(true)
    expect(doorLeafBlocks(result.volumes, [150, 50, 160, 60], 0, 180)).toBe(true)
  })

  it('uses the measured leaf tip, not the clear width as a leaf-width default', () => {
    const geometry = fixture()
    const input = survey(geometry)
    required(input.leaves[0]).closedTip = p(205, 0)
    const result = inspectFurnitureDoorLeaves(geometry, input)
    expect(result.error).toBeUndefined()
    expect(required(result.volumes[0]).bounds[3]).toBeGreaterThanOrEqual(105)
  })

  it('one physical leaf covers both preserved source faces, duplicate leaves hold', () => {
    const geometry = fixture(true)
    const input = survey(geometry)
    const result = inspectFurnitureDoorLeaves(geometry, input)
    expect(result.error).toBeUndefined()
    expect(required(result.volumes[1]).openingIds).toEqual(['first', 'second'])
    input.leaves.push({
      ...required(input.leaves[1]),
      openingId: 'second',
      hinge: p(320, 100),
      closedTip: p(320, 200),
    })
    expect(inspectFurnitureDoorLeaves(geometry, input).error).toBeDefined()
  })

  it('accepts the measured hinge on the opposite preserved face of a paired door', () => {
    const geometry = fixture(true)
    const input = survey(geometry)
    Object.assign(required(input.leaves[1]), {
      openingId: 'second',
      hinge: p(320, 200),
      closedTip: p(320, 95),
      openAngleDeg: -90,
    })
    expect(inspectFurnitureDoorLeaves(geometry, input).error).toBeUndefined()
  })

  it('holds conflicting source cuts and changed paired ownership', () => {
    const geometry = fixture(true)
    const calibration = required(geometry.pdfCalibration)
    const pair = required(required(calibration.openingFacePairs)[0])
    calibration.openingWidthProofs = [
      ...required(calibration.openingWidthProofs),
      { ...structuredClone(pair.bindings[0]), cut: [p(300, 100), p(300, 201)], labelIndex: 2 },
    ]
    expect(inspectFurnitureDoorLeaves(geometry, survey(geometry)).error).toBeDefined()
    required(geometry.openings[1]).widthCm = 101
    expect(inspectFurnitureDoorLeaves(geometry, survey(geometry)).error).toBeDefined()
  })

  it('rejects unrecognised fields, unknown sources and non-finite dimensions', () => {
    const geometry = fixture()
    const input = survey(geometry)
    expect(inspectFurnitureDoorLeaves(geometry, { ...input, assumed: true }).error).toBeDefined()
    expect(
      inspectFurnitureDoorLeaves(geometry, { ...input, source: { kind: 'ai', reference: 'Guess' } })
        .error,
    ).toBeDefined()
    required(input.leaves[0]).thicknessCm = Infinity
    expect(inspectFurnitureDoorLeaves(geometry, input).error).toBeDefined()
  })

  it.each(['geometryKey', 'referenceKey'] as const)('rejects stale %s', (key) => {
    const geometry = fixture()
    const input = survey(geometry)
    input[key] += 'stale'
    expect(inspectFurnitureDoorLeaves(geometry, input)).toMatchObject({
      error: expect.any(String),
      volumes: [],
    })
  })

  it.each([
    { hinge: p(100.001, 0) },
    { closedTip: p(200, 0.001) },
    { closedTip: p(90, 0) },
    { closedTip: p(100, 0) },
    { bottomElevationCm: -0.001 },
    { topElevationCm: 220.001 },
    { topElevationCm: 0 },
    { thicknessCm: 0 },
    { openAngleDeg: 180.001 },
    { mode: 'unknown' },
  ])('holds invalid leaf $hinge $closedTip $topElevationCm $mode', (mutation) => {
    const geometry = fixture()
    const input = survey(geometry)
    Object.assign(required(input.leaves[0]), mutation)
    expect(inspectFurnitureDoorLeaves(geometry, input).error).toBeDefined()
  })

  it('holds a missing door leaf and a missing explicit acknowledgement', () => {
    const geometry = fixture()
    const input = survey(geometry)
    expect(inspectFurnitureDoorLeaves(geometry, { ...input, leaves: [] }).error).toBeDefined()
    expect(
      inspectFurnitureDoorLeaves(geometry, { ...input, acknowledged: false }).error,
    ).toBeDefined()
  })

  it('holds unknown opening height even after updating request keys', () => {
    const geometry = fixture()
    delete required(geometry.openings[0]).heightCm
    expect(inspectFurnitureDoorLeaves(geometry, survey(geometry)).error).toBeDefined()
  })

  it('does not require a leaf on a window', () => {
    const geometry = fixture(false, true)
    expect(inspectFurnitureDoorLeaves(geometry, { ...survey(geometry), leaves: [] })).toEqual({
      volumes: [],
    })
  })

  it('blocks boundary contact but permits genuinely separate vertical spans', () => {
    const geometry = fixture()
    const result = inspectFurnitureDoorLeaves(geometry, survey(geometry))
    expect(doorLeafBlocks(result.volumes, [95, 40, 105, 60], 210, 220)).toBe(true)
    expect(doorLeafBlocks(result.volumes, [95, 40, 105, 60], 210.001, 220)).toBe(false)
    expect(doorLeafBlocks(result.volumes, [95, 40, 105, 60], -10, -0.001)).toBe(false)
    expect(doorLeafBlocks(result.volumes, [95, 40, 105, 60], NaN, 220)).toBe(true)
  })
})
