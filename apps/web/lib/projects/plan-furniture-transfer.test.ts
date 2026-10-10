import type { PlanGeometry, PlanOpeningBinding, PlanPoint, PlanWallFacePair } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { inspectFurnitureTransfer } from './plan-furniture-transfer'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const p = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const box = (left: number, top: number, right: number, bottom: number) => [
  p(left, top),
  p(right, top),
  p(right, bottom),
  p(left, bottom),
]
const body = (polygon: PlanPoint[]): Polygon => [polygon.map(({ xCm, yCm }) => [xCm, yCm])]
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Incomplete synthetic transfer fixture')
  return value
}
const request = {
  widthCm: 40,
  depthCm: 80,
  heightCm: 180,
  clearanceCm: 5,
  orientation: 0 as const,
  acknowledged: true,
}
type Options = {
  narrow?: boolean
  diagonal?: boolean
  negative?: boolean
  secondLevel?: number
  thresholdTop?: number | 'unknown'
  ceiling?: number | 'unknown'
  secondCeiling?: number | 'unknown'
  entryHeight?: number | 'unknown'
  portalHeight?: number | 'unknown'
  portalBottom?: number | 'unknown'
}

/** Synthetic rigid upright survey, not measurements inferred from the user's plan. */
function fixture(options: Options = {}): PlanGeometry {
  const low = options.narrow ? 100 : 70
  const high = options.narrow ? 200 : 230
  const rooms: PlanGeometry['rooms'] = [
    { name: 'Interior', sourceNumber: 1, polygon: box(0, 0, 300, 300) },
    { name: 'Second room', sourceNumber: 2, polygon: box(320, 0, 620, 300) },
    ...(options.negative
      ? [{ name: 'Separate zero anchor', sourceNumber: 3, polygon: box(700, 0, 800, 100) }]
      : []),
  ]
  const walls: PlanGeometry['walls'] = [
    { id: 'entry-wall', kind: 'outer', start: p(0, 0), end: p(300, 0), heightCm: 270 },
    { id: 'first-face', kind: 'inner', start: p(300, 0), end: p(300, 300), heightCm: 270 },
    { id: 'second-face', kind: 'inner', start: p(320, 0), end: p(320, 300), heightCm: 270 },
  ]
  const openings: PlanGeometry['openings'] = [
    {
      id: 'entry',
      type: 'door',
      wallId: 'entry-wall',
      offsetCm: 70,
      widthCm: 160,
      bottomCm: 0,
      heightCm: options.entryHeight === 'unknown' ? undefined : (options.entryHeight ?? 210),
      clearance: { side: 'left', depthCm: 150, shape: 'rectangle' },
    },
    {
      id: 'first',
      type: 'door',
      wallId: 'first-face',
      offsetCm: low,
      widthCm: high - low,
      bottomCm: options.portalBottom === 'unknown' ? undefined : (options.portalBottom ?? 0),
      heightCm: options.portalHeight === 'unknown' ? undefined : (options.portalHeight ?? 210),
    },
    {
      id: 'second',
      type: 'door',
      wallId: 'second-face',
      offsetCm: low,
      widthCm: high - low,
      bottomCm:
        options.portalBottom === 'unknown'
          ? undefined
          : (options.portalBottom ?? 0) - (options.secondLevel ?? 0),
      heightCm: options.portalHeight === 'unknown' ? undefined : (options.portalHeight ?? 210),
    },
  ]
  const bindings: PlanOpeningBinding[] = openings.map((opening, index) => ({
    opening: structuredClone(opening),
    wall: structuredClone(required(walls[index])),
    cut:
      index === 0
        ? [p(70, 0), p(230, 0)]
        : [p(index === 1 ? 300 : 320, low), p(index === 1 ? 300 : 320, high)],
  }))
  const strip = (from: number, to: number, operationIndex: number): PlanWallFacePair => ({
    faces: [300, 320].map((x, index) => ({
      wall: structuredClone(required(walls[index + 1])),
      start: p(x, from),
      end: p(x, to),
      nativeSegment: { operationIndex, subpathIndex: 0, segmentIndex: index },
    })) as PlanWallFacePair['faces'],
    openings: structuredClone(openings.slice(1)),
  })
  let geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: options.negative ? 800 : 620,
    heightCm: 300,
    warnings: [],
    footprint: box(0, 0, options.negative ? 800 : 620, 300),
    rooms,
    walls,
    openings,
    routeStartOpeningId: 'entry',
    routeWidthCm: 70,
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [1],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      openingWidthProofs: [{ ...structuredClone(required(bindings[0])), labelIndex: 1 }],
      openingFacePairs: [
        {
          bindings: [required(bindings[1]), required(bindings[2])],
          jambs: [
            { operationIndex: 12, subpathIndex: 0, segmentIndex: 0 },
            { operationIndex: 12, subpathIndex: 0, segmentIndex: 1 },
          ],
        },
      ],
      sourceWallFacePairs: [strip(0, low, 10), strip(high, 300, 11)],
    },
  }
  if (options.diagonal) {
    geometry = JSON.parse(
      JSON.stringify(geometry, (_key, value) => {
        if (value && typeof value === 'object' && 'xCm' in value && 'yCm' in value)
          return p(
            500 + (3 * value.xCm - 4 * value.yCm) / 5,
            100 + (4 * value.xCm + 3 * value.yCm) / 5,
          )
        return value
      }),
    ) as PlanGeometry
    geometry.widthCm = 1000
    geometry.heightCm = 1000
  }
  return resurvey(geometry, options)
}

function resurvey(geometry: PlanGeometry, options: Options = {}): PlanGeometry {
  const floorLevel = (index: number) =>
    options.negative ? (index === 2 ? 0 : -15) : index ? (options.secondLevel ?? 0) : 0
  const ceilings = geometry.rooms.flatMap((_room, index) => {
    const ceiling = index === 1 ? (options.secondCeiling ?? options.ceiling) : options.ceiling
    return ceiling === 'unknown'
      ? []
      : [
          {
            id: `ceiling-${index}`,
            floorId: `floor-${index}`,
            elevationCm: floorLevel(index) + (ceiling ?? 270),
          },
        ]
  })
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'upright-survey',
      kind: 'finished-floor',
      zeroFloorId: options.negative ? 'floor-2' : 'floor-0',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: `floor-${index}`,
        room,
        surface: 'finished-floor',
        elevationCm: floorLevel(index),
      })),
      ceilings,
      wallBases: geometry.walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: id === 'second-face' ? 'floor-1' : 'floor-0',
      })),
      thresholds:
        options.thresholdTop === 'unknown'
          ? []
          : [
              {
                id: 'threshold',
                elevationCm: options.thresholdTop ?? (options.negative ? -15 : 0),
                bindings: geometry.openings
                  .slice(1)
                  .map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
                    opening: { id, type, wallId, offsetCm, widthCm },
                    floorId: `floor-${index}`,
                  })),
              },
            ],
      source: { kind: 'site-measurement', reference: 'Synthetic upright transfer fixture only' },
    },
    'test-surveyor',
    '2026-10-11T09:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}

describe('bounded upright rigid furniture transfer', () => {
  it('constructs rectangular routes with explicit XY and head clearance without mutating input', () => {
    const geometry = fixture()
    const before = structuredClone(geometry)
    const response = inspectFurnitureTransfer(geometry, request)
    expect(response.error).toBeUndefined()
    const result = required(response.inspection?.result)
    expect(result.routes).toHaveLength(2)
    expect(result.footprint).toBe('axis-aligned-rectangle')
    expect(result.footprintCm).toEqual({ widthCm: 50, depthCm: 90 })
    expect(response.notes.length).toBeGreaterThan(0)
    expect(geometry).toEqual(before)
  })
  it('adds entered decimal clearance exactly instead of rounding the physical profile', () => {
    const response = inspectFurnitureTransfer(fixture(), {
      ...request,
      widthCm: 40.1,
      depthCm: 80.2,
      heightCm: 180.1,
      clearanceCm: 0.2,
    })
    expect(response.inspection?.result?.footprintCm).toEqual({ widthCm: 40.5, depthCm: 80.6 })
    expect(response.inspection?.result?.routes).toHaveLength(2)
  })
  it('allows exact equality with the entered ceiling and aperture clearance envelope', () => {
    const response = inspectFurnitureTransfer(
      fixture({ ceiling: 185, entryHeight: 185, portalHeight: 185 }),
      request,
    )
    expect(response.inspection?.result?.routes).toHaveLength(2)
  })
  it.each([{ ceiling: 184.999999999 }, { entryHeight: 184.999999999 }])(
    'does not use a physical epsilon to squeeze below a known start limit: %j',
    (options) => {
      expect(
        inspectFurnitureTransfer(fixture(options), request).inspection?.result?.routes.length ?? 0,
      ).toBe(0)
    },
  )
  it('does not use a physical epsilon to squeeze through a slightly undersized aperture', () => {
    const result = required(
      inspectFurnitureTransfer(fixture({ portalHeight: 184.999999999 }), request).inspection
        ?.result,
    )
    expect(result.routes.map((route) => route.roomId)).toEqual(['0'])
    expect(result.unresolvedRoomIds).toContain('1')
  })
  it('uses a real non-square profile: orientation 0 passes, orientation 90 does not fit the cut', () => {
    const geometry = fixture({ narrow: true })
    const profile = { ...request, widthCm: 120, depthCm: 40, clearanceCm: 0 }
    const passed = required(inspectFurnitureTransfer(geometry, profile).inspection?.result)
    expect(passed.footprintCm).toEqual({ widthCm: 120, depthCm: 40 })
    expect(passed.routes).toHaveLength(2)
    const rotated = inspectFurnitureTransfer(geometry, { ...profile, orientation: 90 })
    expect(rotated.inspection?.result?.routes.some((route) => route.roomId === '1') ?? false).toBe(
      false,
    )
  })
  it('proves the whole swept rectangular profile rather than only endpoint footprints', () => {
    const geometry = fixture()
    const result = required(inspectFurnitureTransfer(geometry, request).inspection?.result)
    const allowed = polygonClipping.union(
      body(required(geometry.rooms[0]).polygon),
      body(required(geometry.rooms[1]).polygon),
      body(box(300, 70, 320, 230)),
    )
    for (const route of result.routes)
      for (let index = 1; index < route.points.length; index++) {
        const a = required(route.points[index - 1])
        const b = required(route.points[index])
        const swept = body(
          box(
            Math.min(a.xCm, b.xCm) - 25,
            Math.min(a.yCm, b.yCm) - 45,
            Math.max(a.xCm, b.xCm) + 25,
            Math.max(a.yCm, b.yCm) + 45,
          ),
        )
        expect(polygonClipping.difference(swept, allowed)).toEqual([])
      }
  })
  it.each([
    undefined,
    null,
    false,
    {},
    { ...request, heightCm: undefined },
    { ...request, acknowledged: false },
    { ...request, acknowledged: 1 },
    { ...request, orientation: 45 },
    { ...request, widthCm: 0 },
    { ...request, widthCm: 1001 },
    { ...request, depthCm: -1 },
    { ...request, depthCm: 1001 },
    { ...request, heightCm: 0 },
    { ...request, heightCm: 601 },
    { ...request, clearanceCm: -1 },
    { ...request, clearanceCm: 101 },
    { ...request, lift: true },
    { ...request, heightCm: Number.NaN },
  ])('rejects malformed, unacknowledged or unknown-height requests: %j', (input) => {
    const response = inspectFurnitureTransfer(fixture(), input)
    expect(response.error).toBeTruthy()
    expect(response.inspection).toBeUndefined()
  })
  it.each([
    { ceiling: 'unknown' as const },
    { ceiling: 180 },
    { entryHeight: 'unknown' as const },
    { entryHeight: 180 },
  ])('holds an unknown or insufficient start ceiling/aperture: %j', (options) => {
    const response = inspectFurnitureTransfer(fixture(options), request)
    expect(response.inspection?.result?.routes.length ?? 0).toBe(0)
    expect(Boolean(response.error || response.inspection?.missing)).toBe(true)
  })
  it.each([
    { portalHeight: 'unknown' as const },
    { portalHeight: 180 },
    { secondCeiling: 'unknown' as const },
    { secondCeiling: 180 },
    { secondLevel: -15 },
    { thresholdTop: 'unknown' as const },
    { thresholdTop: 2 },
    { portalBottom: 'unknown' as const },
    { portalBottom: 2 },
  ])('holds a transition without calling it physically impossible: %j', (options) => {
    const response = inspectFurnitureTransfer(fixture(options), request)
    const result = required(response.inspection?.result)
    expect(result.routes.some((route) => route.roomId === '0')).toBe(true)
    expect(result.routes.some((route) => route.roomId === '1')).toBe(false)
    expect(result.unresolvedRoomIds).toContain('1')
    expect(response.notes.join(' ')).toContain('не доказывает невозможность')
  })
  it('holds stale approval and accepts a separately reapproved source again', () => {
    const geometry = fixture()
    required(required(geometry.rooms[0]).polygon[0]).xCm += 1
    expect(inspectFurnitureTransfer(geometry, request).inspection?.result).toBeUndefined()
    const fresh = fixture()
    const reapproved = resurvey(fresh)
    expect(inspectFurnitureTransfer(reapproved, request).inspection?.result?.routes).toHaveLength(2)
  })
  it('does not fall back to manual axes or a draft geometry with signed heights', () => {
    const draft = fixture()
    draft.status = 'draft'
    expect(inspectFurnitureTransfer(draft, request).inspection?.result).toBeUndefined()
    const manual = fixture()
    delete manual.pdfCalibration
    const {
      contextSnapshot: _context,
      verifiedAt: _date,
      verifiedBy: _user,
      ...reference
    } = required(manual.verticalReference)
    const approved = applyPlanVerticalReference(
      manual,
      {
        ...reference,
        thresholds: [],
        acknowledged: true,
      },
      'test-surveyor',
      '2026-10-11T10:00:00.000Z',
    )
    if (!approved.ok) throw new Error(approved.error)
    const response = inspectFurnitureTransfer(approved.geometry, request)
    expect(response.inspection).toBeUndefined()
    expect(response.error).toBeTruthy()
  })
  it('does not treat known legacy aperture heights as approval of a common floor datum', () => {
    const geometry = fixture()
    delete geometry.verticalReference
    const response = inspectFurnitureTransfer(geometry, request)
    expect(response.inspection).toBeUndefined()
    expect(response.error).toBeTruthy()
  })
  it('checks a diagonal metric door with the same upright rectangular profile', () => {
    const result = required(
      inspectFurnitureTransfer(fixture({ diagonal: true }), request).inspection?.result,
    )
    expect(result.routes).toHaveLength(2)
    expect(result.footprintCm).toEqual({ widthCm: 50, depthCm: 90 })
  })
  it('uses negative floor elevation, not a silent zero, for every successful route point', () => {
    const result = required(
      inspectFurnitureTransfer(fixture({ negative: true }), request).inspection?.result,
    )
    expect(result.routes.map((route) => route.roomId).sort()).toEqual(['0', '1'])
    expect(result.unresolvedRoomIds).toContain('2')
    expect(result.vertical?.elevationCm).toBe(-15)
    for (const route of result.routes) for (const point of route.points) expect(point.zCm).toBe(-15)
  })
})
