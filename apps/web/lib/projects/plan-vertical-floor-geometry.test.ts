import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  signedElevationSum,
  signedPlanFloors,
  verticalReferenceReviewKey,
} from './plan-vertical-floor-geometry'
import { applyPlanVerticalReference } from './plan-vertical-reference'

const box = (left: number, top: number, right: number, bottom: number): PlanPoint[] => [
  { xCm: left, yCm: top },
  { xCm: right, yCm: top },
  { xCm: right, yCm: bottom },
  { xCm: left, yCm: bottom },
]

function accepted(
  polygons = [box(0, 0, 400, 300), box(0, 315, 200, 535), box(415, 0, 535, 300)],
  voids: PlanPoint[][] = [],
): PlanGeometry {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 535,
    heightCm: 535,
    footprint: box(0, 0, 535, 535),
    rooms: polygons.map((polygon, index) => ({
      name: `Physical room ${index}`,
      polygon,
      sourceNumber: index + 1,
    })),
    walls: [],
    openings: [],
    voids: voids.map((polygon, index) => ({ id: `void-${index}`, polygon })),
    warnings: [],
  }
  const result = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'synthetic-datum',
      kind: 'finished-floor',
      zeroFloorId: 'floor-0',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: `floor-${index}`,
        room: structuredClone(room),
        surface: 'finished-floor',
        elevationCm: index === 0 ? 0 : index === 1 ? -2 : -15,
      })),
      wallBases: [],
      thresholds: [],
      source: {
        kind: 'site-measurement',
        reference: 'Synthetic regression measurements, not a user apartment',
      },
    },
    'qa-owner',
    '2026-10-11T00:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

describe('known signed physical floor surfaces', () => {
  it('returns separate levels and never fills the unknown extent between rooms', () => {
    const geometry = accepted()
    const before = structuredClone(geometry)
    const result = signedPlanFloors(geometry)
    expect(result?.ok).toBe(true)
    if (!result?.ok) throw new Error('Missing signed floors')
    expect(result.surfaces.map((floor) => floor.elevationCm)).toEqual([0, -2, -15])
    expect(result.surfaces.map((floor) => floor.floor)).toEqual(
      geometry.rooms.map((room) => room.polygon),
    )
    expect(result.surfaces.map((floor) => floor.roomId)).toEqual([
      'plan-floor:floor-0',
      'plan-floor:floor-1',
      'plan-floor:floor-2',
    ])
    expect(geometry).toEqual(before)
  })

  it('preserves internal holes and clips a void touching the floor boundary', () => {
    const geometry = accepted([box(0, 0, 400, 300)], [box(20, 20, 40, 40), box(300, 0, 400, 40)])
    const result = signedPlanFloors(geometry)
    if (!result?.ok) throw new Error('Missing clipped floors')
    expect(result.surfaces).toHaveLength(1)
    expect(result.surfaces[0]?.voids).toHaveLength(1)
    expect(result.surfaces[0]?.floor).toContainEqual({ xCm: 300, yCm: 40 })
    expect(result.surfaces[0]?.floor).not.toContainEqual({ xCm: 400, yCm: 0 })
  })

  it('keeps the same floor owner when a void splits its physical surface', () => {
    const result = signedPlanFloors(accepted([box(0, 0, 400, 300)], [box(190, 0, 210, 300)]))
    if (!result?.ok) throw new Error('Missing split floors')
    expect(result.surfaces).toHaveLength(2)
    expect(
      result.surfaces.every((floor) => floor.floorId === 'floor-0' && floor.elevationCm === 0),
    ).toBe(true)
  })

  it.each([
    ['overlapping', [box(0, 0, 300, 300), box(200, 100, 400, 300)]],
    ['outside extent', [box(0, 0, 540, 300)]],
    [
      'self crossing',
      [
        [
          { xCm: 0, yCm: 0 },
          { xCm: 400, yCm: 300 },
          { xCm: 0, yCm: 300 },
          { xCm: 350, yCm: 0 },
        ],
      ],
    ],
    ['zero edge', [[...box(0, 0, 400, 300), { xCm: 0, yCm: 300 }]]],
    [
      'backtracking',
      [
        [
          { xCm: 0, yCm: 0 },
          { xCm: 300, yCm: 0 },
          { xCm: 200, yCm: 0 },
          { xCm: 400, yCm: 300 },
          { xCm: 0, yCm: 300 },
        ],
      ],
    ],
  ] as const)(
    'holds %s contours rather than producing a zero-level fallback',
    (_label, polygons) => {
      expect(
        signedPlanFloors(
          accepted(polygons.map((polygon) => polygon.map((point) => ({ ...point })))),
        )?.ok,
      ).toBe(false)
    },
  )

  it('holds a floor entirely removed by a void', () => {
    expect(signedPlanFloors(accepted([box(0, 0, 400, 300)], [box(0, 0, 400, 300)]))?.ok).toBe(false)
  })

  it('allows adjacent physical owners with no positive-area overlap', () => {
    expect(signedPlanFloors(accepted([box(0, 0, 200, 300), box(200, 0, 400, 300)]))?.ok).toBe(true)
  })

  it('distinguishes absent, malformed, stale and unconfirmed references', () => {
    const geometry = accepted()
    const legacy = structuredClone(geometry)
    delete legacy.verticalReference
    expect(signedPlanFloors(legacy)).toBeUndefined()
    expect(
      signedPlanFloors({ ...geometry, verticalReference: null } as unknown as PlanGeometry)?.ok,
    ).toBe(false)
    expect(signedPlanFloors({ ...geometry, status: 'draft' })?.ok).toBe(false)
    const first = geometry.rooms[0]?.polygon[0]
    if (!first) throw new Error('Missing synthetic floor vertex')
    first.xCm = 1
    expect(signedPlanFloors(geometry)?.ok).toBe(false)
  })

  it('bounds aggregate contour complexity before clipping', () => {
    const polygons = Array.from({ length: 200 }, (_, index) => {
      const x = (index % 20) * 20
      const y = Math.floor(index / 20) * 20
      return Array.from({ length: 24 }, (_, vertex) => ({
        xCm: x + 5 + 4 * Math.cos((vertex * Math.PI) / 12),
        yCm: y + 5 + 4 * Math.sin((vertex * Math.PI) / 12),
      }))
    })
    const geometry = accepted()
    const reference = geometry.verticalReference
    if (!reference) throw new Error('Missing synthetic reference')
    geometry.rooms = polygons.map((polygon, index) => ({
      name: `Physical room ${index}`,
      polygon,
      sourceNumber: index + 1,
    }))
    reference.floors = geometry.rooms.map((room, index) => ({
      id: `floor-${index}`,
      room: structuredClone(room),
      surface: 'finished-floor',
      elevationCm: 0,
    }))
    const result = signedPlanFloors(geometry)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Слишком сложные') })
  })

  it('includes source identity and confirmation in the layout review key', () => {
    const reference = accepted().verticalReference
    if (!reference) throw new Error('Missing synthetic reference')
    const key = verticalReferenceReviewKey(reference)
    expect(
      verticalReferenceReviewKey({
        ...reference,
        ceilings: [{ id: 'ceiling', floorId: 'floor-0', elevationCm: 240 }],
      }),
    ).not.toBe(key)
    expect(
      verticalReferenceReviewKey({ ...reference, verifiedAt: '2026-10-11T01:00:00.000Z' }),
    ).not.toBe(key)
    expect(
      verticalReferenceReviewKey({
        ...reference,
        source: { ...reference.source, reference: 'Different survey' },
      }),
    ).not.toBe(key)
  })
})

describe('exact decimal elevation arithmetic', () => {
  it.each([
    [0.1, 0.2, 0.3],
    [-0.2, 0.3, 0.1],
    [-15, 17, 2],
    [-600, 0.001, -599.999],
    [1e-7, 2e-7, 3e-7],
  ])('adds %s and %s without a physical tolerance', (base, height, expected) => {
    expect(signedElevationSum(base, height)).toBe(expected)
  })
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid heights %s',
    (value) => {
      expect(() => signedElevationSum(0, value)).toThrow()
    },
  )
})
