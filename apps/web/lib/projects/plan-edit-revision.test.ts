import type { PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planEditRevision } from './plan-edit-revision'

const reading: PlanReading = {
  readAt: '2026-09-27T00:00:00Z',
  rooms: [{ name: 'Спальня', kind: 'bedroom', widthCm: 400, depthCm: 300 }],
  geometry: {
    version: 1,
    status: 'draft',
    widthCm: 400,
    heightCm: 300,
    walls: [],
    openings: [],
    rooms: [],
    warnings: [],
  },
}

describe('2D editor source revision', () => {
  it('is stable after JSONB object keys are reordered', () => {
    const reordered: PlanReading = {
      geometry: reading.geometry,
      rooms: reading.rooms.map(({ depthCm, widthCm, kind, name }) => ({
        depthCm,
        widthCm,
        kind,
        name,
      })),
      readAt: reading.readAt,
    }
    expect(planEditRevision('plan.webp', reordered)).toBe(planEditRevision('plan.webp', reading))
  })

  it('changes after replacing the file, correcting a room, editing or removing the scheme', () => {
    const revision = planEditRevision('plan.webp', reading)
    expect(planEditRevision('new-plan.webp', reading)).not.toBe(revision)
    expect(planEditRevision('plan.webp', { ...reading, rooms: [] })).not.toBe(revision)
    expect(planEditRevision('plan.webp', { ...reading, geometry: undefined })).not.toBe(revision)
    expect(
      planEditRevision('plan.webp', {
        ...reading,
        geometry: reading.geometry ? { ...reading.geometry, widthCm: 360 } : undefined,
      }),
    ).not.toBe(revision)
  })
})
