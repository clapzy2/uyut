import type { LayoutItem } from '@uyut/catalog'
import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { layoutWithMeasurements } from './layout-with-measurements'

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
})
