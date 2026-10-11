import type { PlanGeometry, PlanOpeningBinding, PlanPoint, PlanWallFacePair } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const p = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const rotate = (x: number, y: number) => p(300 + (3 * x - 4 * y) / 5, 100 + (4 * x + 3 * y) / 5)
const box = (left: number, top: number, right: number, bottom: number) => [
  rotate(left, top),
  rotate(right, top),
  rotate(right, bottom),
  rotate(left, bottom),
]
const body = (polygon: PlanPoint[]): Polygon => [polygon.map(({ xCm, yCm }) => [xCm, yCm])]
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Incomplete synthetic route fixture')
  return value
}
type Options = {
  reverseCuts?: boolean
  reverseRooms?: boolean
  closedRooms?: boolean
  cyclicRooms?: boolean
  fractional?: boolean
  secondLevel?: number
  thresholdTop?: number | 'unknown'
  void?: boolean
  obstacle?: boolean
  extraWall?: boolean
  noSourcePair?: boolean
  skew?: boolean
  unknownBottom?: boolean
  swingEntry?: boolean
  roundedEntry?: boolean
  routeWidth?: number
  tangentWall?: boolean
  negativeStart?: boolean
}

/** Synthetic 3-4-5 rotation with a 120 cm cut, not an inferred apartment measurement. */
function fixture(options: Options = {}): PlanGeometry {
  const rooms: PlanGeometry['rooms'] = [
    { name: 'Interior', sourceNumber: 1, polygon: box(0, 0, 200, 200) },
    { name: 'Balcony', sourceNumber: 2, spaceKind: 'balcony', polygon: box(210, 0, 410, 200) },
  ]
  if (options.negativeStart)
    rooms.push({
      name: 'Separate zero anchor',
      sourceNumber: 3,
      polygon: [p(600, 20), p(680, 20), p(680, 100), p(600, 100)],
    })
  const walls: PlanGeometry['walls'] = [
    { id: 'entry-wall', kind: 'outer', start: rotate(0, 0), end: rotate(200, 0), heightCm: 270 },
    {
      id: 'first-face',
      kind: 'inner',
      start: rotate(200, 0),
      end: rotate(200, 200),
      heightCm: 270,
    },
    {
      id: 'second-face',
      kind: 'inner',
      start: rotate(210, 0),
      end: rotate(210, 200),
      heightCm: 270,
    },
  ]
  const openings: PlanGeometry['openings'] = [
    {
      id: 'entry',
      type: 'door',
      wallId: 'entry-wall',
      offsetCm: 40,
      widthCm: 120,
      bottomCm: 0,
      heightCm: 210,
      clearance: { side: 'left', depthCm: 100, shape: 'rectangle' },
    },
    {
      id: 'inside',
      type: 'balcony',
      wallId: 'first-face',
      offsetCm: 40,
      widthCm: 120,
      bottomCm: 0,
      heightCm: 210,
    },
    {
      id: 'outside',
      type: 'balcony',
      wallId: 'second-face',
      offsetCm: 40,
      widthCm: 120,
      bottomCm: -(options.secondLevel ?? 0),
      heightCm: 210,
    },
  ]
  if (options.unknownBottom) delete required(openings[2]).bottomCm
  if (options.swingEntry)
    required(openings[0]).clearance = {
      side: 'left',
      depthCm: 100,
      shape: 'swing',
      hinge: 'start',
    }
  if (options.roundedEntry) {
    required(openings[0]).offsetCm += 0.19
    required(openings[0]).widthCm += 0.19
  }
  const cuts: [PlanPoint, PlanPoint][] = [
    [rotate(40, 0), rotate(160, 0)],
    [rotate(200, 40), rotate(200, 160)],
    [rotate(210, 40), rotate(210, 160)],
  ]
  const bindings = cuts.map(
    (cut, index): PlanOpeningBinding => ({
      opening: structuredClone(required(openings[index])),
      wall: structuredClone(required(walls[index])),
      cut: structuredClone(cut),
    }),
  )
  if (options.reverseCuts) for (const binding of bindings) binding.cut?.reverse()
  for (const room of rooms) {
    if (options.reverseRooms) room.polygon.reverse()
    if (options.cyclicRooms) room.polygon = [...room.polygon.slice(1), required(room.polygon[0])]
    if (options.closedRooms) room.polygon.push(structuredClone(required(room.polygon[0])))
  }
  const strip = (from: number, to: number, operationIndex: number): PlanWallFacePair => ({
    faces: [200, 210].map((x, index) => ({
      wall: structuredClone(required(walls[index + 1])),
      start: rotate(x, from),
      end: rotate(x, to),
      nativeSegment: { operationIndex, subpathIndex: 0, segmentIndex: index },
    })) as PlanWallFacePair['faces'],
    openings: structuredClone(openings.slice(1)),
  })
  let geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 700,
    heightCm: 700,
    warnings: [],
    footprint: [p(0, 0), p(700, 0), p(700, 700), p(0, 700)],
    rooms,
    walls,
    openings,
    routeWidthCm: options.routeWidth ?? 40,
    routeStartOpeningId: 'entry',
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [1],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      sourceWallFacePairs: [strip(0, 40, 10), strip(160, 200, 11)],
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
    },
    ...(options.void ? { voids: [{ id: 'portal-void', polygon: box(200, 40, 210, 160) }] } : {}),
    ...(options.obstacle
      ? {
          obstacles: [
            { id: 'portal-obstacle', kind: 'fixed', xCm: 290, yCm: 280, widthCm: 106, depthCm: 88 },
          ],
        }
      : {}),
  }
  if (options.extraWall)
    geometry.walls.push({
      id: 'extra-wall',
      kind: 'inner',
      start: p(338, 320),
      end: p(350, 320),
      heightCm: 270,
    })
  if (options.tangentWall)
    geometry.walls.push({
      id: 'tangent-wall',
      kind: 'inner',
      start: rotate(200, 40),
      end: rotate(200, 160),
      heightCm: 270,
    })
  if (options.fractional)
    geometry = JSON.parse(
      JSON.stringify(geometry, (_key, value) => {
        if (value && typeof value === 'object' && 'xCm' in value && 'yCm' in value)
          return p(value.xCm + 0.2, value.yCm + 0.1)
        return value
      }),
    ) as PlanGeometry
  // A skewed preserved second cut is still on its host, but its jamb projections do not match.
  if (options.skew) {
    const calibration = required(geometry.pdfCalibration)
    const binding = required(calibration.openingFacePairs?.[0]).bindings[1]
    const cut = required(binding.cut)
    cut[0] = rotate(210, 41)
    cut[1] = rotate(210, 161)
    required(geometry.openings[2]).offsetCm = 41
    binding.opening.offsetCm = 41
    for (const pair of calibration.sourceWallFacePairs ?? [])
      required(pair.openings.find((opening) => opening.id === 'outside')).offsetCm = 41
  }
  const thresholds =
    options.thresholdTop === 'unknown'
      ? []
      : [
          {
            id: 'threshold',
            elevationCm: options.thresholdTop ?? (options.negativeStart ? -15 : 0),
            bindings: geometry.openings
              .slice(1)
              .map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
                opening: { id, type, wallId, offsetCm, widthCm },
                floorId: `floor-${index}`,
              })),
          },
        ]
  if (options.noSourcePair) {
    required(geometry.pdfCalibration).openingFacePairs = []
    thresholds.splice(0)
  }
  const accepted = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'route-survey-zero',
      kind: 'finished-floor',
      zeroFloorId: options.negativeStart ? 'floor-2' : 'floor-0',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: `floor-${index}`,
        room,
        surface: 'finished-floor',
        elevationCm: options.negativeStart
          ? index === 2
            ? 0
            : -15
          : index
            ? (options.secondLevel ?? 0)
            : 0,
      })),
      wallBases: geometry.walls.map(({ id, kind, start, end }) => ({
        wall: { id, kind, start, end },
        floorId: id === 'second-face' ? 'floor-1' : 'floor-0',
      })),
      thresholds,
      source: { kind: 'site-measurement', reference: 'Synthetic diagonal route fixture' },
    },
    'test-surveyor',
    '2026-10-11T09:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.geometry
}

describe('diagonal continuous routes on accepted finished floors', () => {
  it.each([
    {},
    { reverseCuts: true },
    { reverseRooms: true },
    { cyclicRooms: true },
    { closedRooms: true },
    { fractional: true },
    { reverseCuts: true, reverseRooms: true, closedRooms: true },
  ])('reaches the second floor without changing source representation: %j', (options) => {
    const geometry = fixture(options)
    const before = structuredClone(geometry)
    const result = required(inspectPdfClearanceRoutes(geometry).result)
    expect(result.routes).toHaveLength(2)
    expect(result.vertical?.heldTransitions).toEqual([])
    expect(result.vertical?.elevationCm).toBe(0)
    for (const route of result.routes) for (const point of route.points) expect(point.zCm).toBe(0)
    expect(geometry).toEqual(before)
  })
  it('proves every whole swept square inside known floor plus only the accepted portal', () => {
    const geometry = fixture()
    const result = required(inspectPdfClearanceRoutes(geometry).result)
    const allowed = polygonClipping.union(
      body(required(geometry.rooms[0]).polygon),
      body(required(geometry.rooms[1]).polygon),
      body(box(200, 40, 210, 160)),
    )
    for (const route of result.routes)
      for (let index = 1; index < route.points.length; index++) {
        const first = required(route.points[index - 1])
        const second = required(route.points[index])
        const left = Math.min(first.xCm, second.xCm) - 20
        const top = Math.min(first.yCm, second.yCm) - 20
        const right = Math.max(first.xCm, second.xCm) + 20
        const bottom = Math.max(first.yCm, second.yCm) + 20
        const swept = body([p(left, top), p(right, top), p(right, bottom), p(left, bottom)])
        expect(polygonClipping.difference(swept, allowed)).toEqual([])
      }
    expect(result.routes.find((route) => route.roomId === '1')?.points.length).toBeGreaterThan(1)
  })
  it('retains a source-anchored swing entry rather than treating it as a rectangular zone', () => {
    const result = required(inspectPdfClearanceRoutes(fixture({ swingEntry: true })).result)
    expect(result.routes).toHaveLength(2)
    expect(required(required(result.routes[0]).points[0])).not.toEqual(p(320, 210))
  })
  it('keeps the entry start unchanged for a .19 cm rounded nominal binding difference', () => {
    const exact = required(inspectPdfClearanceRoutes(fixture()).result)
    const rounded = required(inspectPdfClearanceRoutes(fixture({ roundedEntry: true })).result)
    expect(required(rounded.routes[0]).points[0]).toEqual(required(exact.routes[0]).points[0])
    expect(rounded.routes).toHaveLength(2)
  })
  it('does not fit a 100 cm axis-aligned square through a rotated 120 cm cut', () => {
    // Along the cut its square support is (.6+.8)*100=140 cm; nominal door width alone is insufficient.
    const inspection = inspectPdfClearanceRoutes(fixture({ routeWidth: 100 }))
    expect(inspection.result?.routes.some((route) => route.roomId === '1') ?? false).toBe(false)
    expect(inspection.result?.status).not.toBe('constructive-routes')
  })
  it('keeps an extra tangent wall line as a route barrier despite no interior threshold collision', () => {
    const result = required(inspectPdfClearanceRoutes(fixture({ tangentWall: true })).result)
    // The threshold surface may exist, but an unproven extra wall has no accepted opening cut.
    expect(result.routes.some((route) => route.roomId === '1')).toBe(false)
    expect(result.unresolvedRoomIds).toContain('1')
  })
  it('constructs diagonal routes at negative Z without floating into a separate zero anchor floor', () => {
    const result = required(inspectPdfClearanceRoutes(fixture({ negativeStart: true })).result)
    expect(result.routes.map((route) => route.roomId).sort()).toEqual(['0', '1'])
    expect(result.unresolvedRoomIds).toEqual(['2'])
    expect(result.vertical?.elevationCm).toBe(-15)
    for (const route of result.routes) for (const point of route.points) expect(point.zCm).toBe(-15)
  })
  it.each([
    { secondLevel: -15 },
    { thresholdTop: 'unknown' as const },
    { thresholdTop: 2 },
    { unknownBottom: true },
    { skew: true },
    { void: true },
    { obstacle: true },
    { extraWall: true },
    { noSourcePair: true },
  ])('does not invent continuous floor across a held transition: %j', (options) => {
    const inspection = inspectPdfClearanceRoutes(fixture(options))
    expect(inspection.result?.routes.some((route) => route.roomId === '1') ?? false).toBe(false)
    if (inspection.result) expect(inspection.result.unresolvedRoomIds).toContain('1')
    else expect(inspection.missing).toBeTruthy()
  })
  it('holds conflicting preserved cut claims rather than selecting the convenient one', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const claim = structuredClone(required(calibration.openingFacePairs?.[0]).bindings[0])
    claim.cut = [rotate(200, 41), rotate(200, 161)]
    calibration.openingWidthProofs?.push({ ...claim, labelIndex: 77 })
    const inspection = inspectPdfClearanceRoutes(geometry)
    expect(inspection.result?.routes.some((route) => route.roomId === '1') ?? false).toBe(false)
  })
  it('does not hide overlapping diagonal cut owners merely because one threshold is unknown', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const duplicate = structuredClone(required(calibration.openingFacePairs?.[0]))
    for (const binding of duplicate.bindings) {
      binding.opening.id += '-second-owner'
      geometry.openings.push(structuredClone(binding.opening))
    }
    calibration.openingFacePairs?.push(duplicate)
    for (const strip of calibration.sourceWallFacePairs ?? [])
      strip.openings = structuredClone(
        geometry.openings.filter((opening) => opening.id !== 'entry'),
      )
    const inspection = inspectPdfClearanceRoutes(geometry)
    expect(inspection.result).toBeUndefined()
    expect(inspection.missing).toBeTruthy()
  })
})
