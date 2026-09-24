import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planReviewSource } from './plan-review'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 300,
  heightCm: 300,
  warnings: [],
  walls: [],
  openings: [],
  rooms: [
    {
      name: 'Спальня',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 300, yCm: 0 },
        { xCm: 300, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
    },
  ],
}

describe('source for manual plan review', () => {
  it('requires a confirmed uniquely matched plan, render and room', () => {
    expect(planReviewSource(null, 'render', geometry, 'Спальня')).toBeNull()
    expect(planReviewSource('plan', null, geometry, 'Спальня')).toBeNull()
    expect(
      planReviewSource('plan', 'render', { ...geometry, status: 'draft' }, 'Спальня'),
    ).toBeNull()
    expect(planReviewSource('plan', 'render', geometry, 'Кухня')).toBeNull()
  })

  it('invalidates a verdict if the plan, render or geometry changes', () => {
    const original = planReviewSource('plan-1', 'render-1', geometry, 'Спальня')
    expect(original?.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(planReviewSource('plan-1', 'render-1', geometry, 'Спальня')?.hash).toBe(original?.hash)
    expect(planReviewSource('plan-2', 'render-1', geometry, 'Спальня')?.hash).not.toBe(
      original?.hash,
    )
    expect(planReviewSource('plan-1', 'render-2', geometry, 'Спальня')?.hash).not.toBe(
      original?.hash,
    )
    expect(
      planReviewSource('plan-1', 'render-1', { ...geometry, confirmedAt: 'later' }, 'Спальня')
        ?.hash,
    ).not.toBe(original?.hash)
  })
})
