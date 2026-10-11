import type { LayoutItem } from '@uyut/catalog'
import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { layoutWithMeasurements } from './layout-with-measurements'
import { applyPlanVerticalReference } from './plan-vertical-reference'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic fixture value')
  return value
}

const measurements = {
  widthCm: 300.5,
  depthCm: 200,
  toleranceCm: 1,
  finishStage: 'after',
  verification: {
    widthCm: 300.5,
    depthCm: 200,
    toleranceCm: 1,
    finishStage: 'after',
    confirmedAt: '2026-09-16T00:00:00Z',
  },
} satisfies RoomMeasurements
const sofa: LayoutItem = {
  id: 'sofa',
  title: 'Диван',
  category: 'sofa',
  quantity: 1,
  dimensions: { width: 300.4, depth: 90, height: 80 },
}

describe('layout measurement bounds', () => {
  const signedGeometry = () => {
    const polygon = (x: number) => [
      { xCm: x, yCm: 0 },
      { xCm: x + 400, yCm: 0 },
      { xCm: x + 400, yCm: 300 },
      { xCm: x, yCm: 300 },
    ]
    const source: PlanGeometry = {
      version: 1,
      status: 'confirmed',
      widthCm: 800,
      heightCm: 300,
      warnings: [],
      walls: [],
      openings: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 800, yCm: 0 },
        { xCm: 800, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
      rooms: [
        { name: 'Inside', polygon: polygon(0) },
        { name: 'Balcony', spaceKind: 'balcony', polygon: polygon(400) },
      ],
    }
    const accepted = applyPlanVerticalReference(
      source,
      {
        version: 1,
        id: 'test-survey',
        kind: 'finished-floor',
        zeroFloorId: 'inside',
        acknowledged: true,
        floors: source.rooms.map((room, index) => ({
          id: index ? 'balcony' : 'inside',
          room,
          surface: 'finished-floor',
          elevationCm: index ? -15 : 0,
        })),
        wallBases: [],
        thresholds: [],
        source: { kind: 'site-measurement', reference: 'Synthetic fixture, not real measurements' },
      },
      'test-owner',
      '2026-10-11T09:00:00.000Z',
    )
    if (!accepted.ok) throw new Error(accepted.error)
    return accepted.geometry
  }
  it('derives exact XY from the reviewed physical floor without measurement stretching', () => {
    const source = signedGeometry()
    const result = layoutWithMeasurements('Balcony', measurements, source, [])
    expect(result).not.toBeNull()
    expect(result?.widthCm).toBe(400)
    expect(result?.depthCm).toBe(300)
    expect(result?.floorLevel).toMatchObject({
      floorId: 'balcony',
      elevationCm: -15,
      surface: 'finished-floor',
      origin: { xCm: 400, yCm: 0 },
    })
    expect(result?.measurementNote).toContain('без растягивания')
    expect(
      result?.missingSafetyData.some(
        (message) => message.includes('300.5') && message.includes('400'),
      ),
    ).toBe(true)
    expect(result?.safetySummary.status).toBe('needs-data')
  })
  it('holds a stale signed owner even with measured rectangle dimensions available', () => {
    const source = signedGeometry()
    required(required(source.rooms[1]).polygon[1]).xCm += 1
    expect(layoutWithMeasurements('Balcony', measurements, source, [])).toBeNull()
  })
  it('does not base furniture on an existing slab whose finished elevation is unknown', () => {
    const source = signedGeometry()
    required(required(source.verticalReference).floors[1]).surface = 'existing-floor'
    expect(layoutWithMeasurements('Balcony', measurements, source, [sofa])).toBeNull()
  })
  it('reports unknown ceiling and item height without blocking footprint rendering', () => {
    const source = signedGeometry()
    const item: LayoutItem = {
      id: 'unknown-height',
      title: 'Chair',
      category: 'sofa',
      quantity: 1,
      dimensions: { width: 60, depth: 60 },
    }
    const result = layoutWithMeasurements('Balcony', null, source, [item])
    expect(result).not.toBeNull()
    expect(result?.placed).toHaveLength(1)
    expect(
      result?.safetyChecks.some(
        (check) => check.id === 'signed-ceiling-unknown' && check.status === 'needs-data',
      ),
    ).toBe(true)
    expect(
      result?.safetyChecks.some(
        (check) => check.id.startsWith('signed-height-') && check.status === 'needs-data',
      ),
    ).toBe(true)
  })
  it('blocks vertical fit above a confirmed ceiling without shrinking the furniture', () => {
    const source = signedGeometry()
    required(source.verticalReference).ceilings = [
      { id: 'ceiling-balcony', floorId: 'balcony', elevationCm: 64 },
    ]
    const result = layoutWithMeasurements('Balcony', null, source, [
      { ...sofa, dimensions: { width: 60, depth: 60, height: 80 } },
    ])
    expect(result).not.toBeNull()
    expect(result?.placementInputs[0]?.heightCm).toBe(80)
    expect(
      result?.safetyChecks.find((check) => check.id.startsWith('signed-height-'))?.status,
    ).toBe('blocked')
    expect(result?.safetySummary.status).toBe('blocked')
  })
  it('uses the exact decimal global top when comparing with a confirmed ceiling', () => {
    const source = signedGeometry()
    required(required(source.verticalReference).floors[1]).elevationCm = -0.2
    required(source.verticalReference).ceilings = [
      { id: 'ceiling-balcony', floorId: 'balcony', elevationCm: 0.1 },
    ]
    const result = layoutWithMeasurements('Balcony', null, source, [
      { ...sofa, dimensions: { width: 60, depth: 60, height: 0.3 } },
    ])
    expect(result).not.toBeNull()
    expect(
      result?.safetyChecks.find((check) => check.id.startsWith('signed-height-'))?.status,
    ).toBe('checked')
  })
  it('holds explicit floor references instead of falling back to a measured box', () => {
    const geometry: PlanGeometry = {
      version: 1,
      status: 'confirmed',
      widthCm: 300.5,
      heightCm: 200,
      walls: [],
      openings: [],
      warnings: [],
      rooms: [],
    }
    const legacy = layoutWithMeasurements('Комната', measurements, geometry, [sofa])
    expect(legacy).not.toBeNull()
    expect(
      layoutWithMeasurements(
        'Комната',
        measurements,
        { ...geometry, verticalReference: undefined },
        [sofa],
      ),
    ).toEqual(legacy)

    // Stored JSON is untrusted at this boundary; even falsy or broken references
    // must not become the legacy flat-floor model through a truthiness check.
    for (const reference of [null, false, 0, '', {}, { floors: [{ elevationCm: -15 }] }]) {
      for (const status of ['draft', 'confirmed'] as const) {
        const held = {
          ...geometry,
          status,
          verticalReference: reference,
        } as unknown as PlanGeometry
        expect(layoutWithMeasurements('Комната', measurements, held, [sofa])).toBeNull()
      }
    }
  })

  it('keeps a draft contour as unresolved when falling back to a rectangular preview', () => {
    const geometry: PlanGeometry = {
      version: 1,
      status: 'draft',
      widthCm: 400,
      heightCm: 300,
      walls: [],
      openings: [],
      warnings: [],
      rooms: [
        {
          name: 'Спальня',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 400, yCm: 0 },
            { xCm: 400, yCm: 300 },
            { xCm: 0, yCm: 300 },
          ],
        },
      ],
    }
    const layout = layoutWithMeasurements(
      'Спальня',
      { widthCm: 400, depthCm: 300 },
      geometry,
      [],
      'bedroom',
    )
    expect(layout?.missingSafetyData.join(' ')).toContain('контур')
    expect(layout?.safetySummary.status).toBe('needs-data')
  })
  it('rejects an item fitting nominal dimensions but not their lower bounds', () => {
    const nominal = layoutWithMeasurements(
      'Комната',
      { ...measurements, verification: undefined },
      undefined,
      [sofa],
    )
    const conservative = layoutWithMeasurements('Комната', measurements, undefined, [sofa])
    expect(nominal?.placed).toHaveLength(1)
    expect(conservative?.widthCm).toBe(299.5)
    expect(conservative?.depthCm).toBe(199)
    expect(conservative?.placed).toHaveLength(0)
    expect(conservative?.measurementNote).toContain('по нижней границе')
  })
  it('does not invent a finish allowance or trust stale confirmation', () => {
    for (const data of [
      {
        ...measurements,
        finishStage: 'before' as const,
        verification: { ...measurements.verification, finishStage: 'before' as const },
      },
      { ...measurements, toleranceCm: 2 },
    ]) {
      expect(layoutWithMeasurements('Комната', data, undefined, [])?.widthCm).toBe(300.5)
    }
  })
  it('does not distort a polygon to pretend that its local uncertainty is known', () => {
    const geometry: PlanGeometry = {
      version: 1,
      status: 'confirmed',
      widthCm: 300.5,
      heightCm: 200,
      warnings: [],
      walls: [],
      openings: [],
      rooms: [
        {
          name: 'Комната',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 300.5, yCm: 0 },
            { xCm: 300.5, yCm: 200 },
            { xCm: 0, yCm: 200 },
          ],
        },
      ],
    }
    const result = layoutWithMeasurements('Комната', measurements, geometry, [])
    expect(result?.widthCm).toBe(300.5)
    expect(result?.floorPolygon).toEqual(geometry.rooms[0]?.polygon)
    expect(result?.measurementNote).toContain('ещё не учтена')
  })
  it('does not calculate with non-finite or missing sizes', () => {
    expect(layoutWithMeasurements('Комната', null, undefined, [])).toBeNull()
    expect(
      layoutWithMeasurements('Комната', { widthCm: Infinity, depthCm: 200 }, undefined, []),
    ).toBeNull()
  })

  it('passes the real room name into the function profile', () => {
    const layout = layoutWithMeasurements(
      'Студия 24 м²',
      { widthCm: 600, depthCm: 400 },
      undefined,
      [
        {
          id: 'sofa-bed',
          title: 'Раскладной диван-кровать',
          category: 'sofa',
          quantity: 1,
          dimensions: { width: 190, depth: 90 },
          operationClearance: { front: 120 },
        },
      ],
      'living',
    )

    expect(layout?.functionProfile).toBe('studio')
    expect(layout?.functionChecks).toContainEqual(
      expect.objectContaining({ id: 'food-preparation', status: 'missing' }),
    )
  })
})
