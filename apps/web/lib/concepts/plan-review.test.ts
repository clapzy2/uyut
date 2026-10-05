import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planReviewSource, qualityReviewPlanStatus } from './plan-review'

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
  it('не считает старые извлечённые проёмы актуальными при том же исходнике', () => {
    const current = planReviewSource('plan', 'render', geometry, 'Спальня')
    if (!current) throw new Error('Missing source')
    const review = {
      version: 1 as const,
      status: 'checked' as const,
      model: 'test',
      checkedAt: '2026-10-05T00:00:00Z',
      description: 'Спальня',
      issues: [],
      architecture: current.architecture,
      architectureSourceHash: current.hash,
    }
    const changedFacts = {
      ...current.architecture,
      openings: [{ type: 'window' as const, side: 'top' as const }],
    }
    expect(qualityReviewPlanStatus(review, current.hash, changedFacts)).toBe('changed')
    expect(qualityReviewPlanStatus(review, current.hash, current.architecture)).toBe('current')
    expect(
      qualityReviewPlanStatus(
        {
          ...review,
          architecture: {
            openings: current.architecture.openings,
            shape: current.architecture.shape,
          },
        },
        current.hash,
        current.architecture,
      ),
    ).toBe('current')
    // Ручная отметка по самому исходнику не сбрасывается из-за обновления AI-извлечения.
    expect(planReviewSource('plan', 'render', geometry, 'Спальня')?.hash).toBe(current.hash)
  })
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

  it('invalidates window movement, width and contour changes on the same plan side', () => {
    const withWindow: PlanGeometry = {
      ...geometry,
      walls: [{ id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 300, yCm: 0 } }],
      openings: [{ id: 'window', type: 'window', wallId: 'top', offsetCm: 50, widthCm: 100 }],
    }
    const original = planReviewSource('plan', 'render', withWindow, 'Спальня')
    const opening = withWindow.openings[0]
    const room = withWindow.rooms[0]
    if (!original || !opening || !room) throw new Error('missing fixture')
    const review = {
      version: 1 as const,
      status: 'checked' as const,
      model: 'test',
      checkedAt: '2026-10-04T00:00:00Z',
      architecture: original.architecture,
      architectureSourceHash: original.hash,
      issues: [],
      description: 'Спальня.',
    }
    expect(qualityReviewPlanStatus(review, original.hash)).toBe('current')
    for (const changed of [
      { ...withWindow, openings: [{ ...opening, offsetCm: 60 }] },
      { ...withWindow, openings: [{ ...opening, widthCm: 110 }] },
      {
        ...withWindow,
        rooms: [
          {
            ...room,
            polygon: room.polygon.map((point) => ({
              ...point,
              xCm: point.xCm === 300 ? 320 : point.xCm,
            })),
          },
        ],
      },
    ]) {
      const source = planReviewSource('plan', 'render', changed, 'Спальня')
      expect(source?.architecture).toEqual(original.architecture)
      expect(qualityReviewPlanStatus(review, source?.hash ?? null)).toBe('changed')
    }
    expect(
      qualityReviewPlanStatus(
        review,
        planReviewSource('plan', 'new-render', withWindow, 'Спальня')?.hash ?? null,
      ),
    ).toBe('changed')
    expect(qualityReviewPlanStatus(review, null)).toBe('changed')
    expect(
      qualityReviewPlanStatus({ ...review, architectureSourceHash: undefined }, original.hash),
    ).toBe('unlinked')
    expect(qualityReviewPlanStatus(null, original.hash)).toBeNull()
  })
})
