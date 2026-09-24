import type { ConceptPlanReview, ConceptQualityReview } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { type PlanReviewSample, planReviewMetrics } from './plan-review-metrics'

const review: ConceptPlanReview = {
  version: 1,
  sourceHash: 'current',
  shape: 'matches',
  openings: ['matches'],
  extraOpenings: 'matches',
  reviewedAt: '2026-09-24T00:00:00Z',
}

const qualityReview: ConceptQualityReview = {
  version: 1,
  status: 'checked',
  model: 'example',
  checkedAt: '2026-09-24T00:00:00Z',
  architecture: {
    shape: 'rectangular',
    openings: [{ type: 'window', side: 'top' }],
  },
  issues: [],
  description: null,
}

function sample(overrides: Partial<PlanReviewSample> = {}): PlanReviewSample {
  return {
    projectId: 'project',
    roomId: 'room',
    roomKind: 'living',
    review,
    currentSourceHash: 'current',
    currentArchitecture: {
      shape: 'rectangular',
      openings: [{ type: 'window', side: 'top' }],
    },
    usesEditedRender: false,
    qualityReview,
    ...overrides,
  }
}

describe('plan/render review metrics', () => {
  it('counts the four outcomes without treating not visible as a pass', () => {
    const conflict = { ...review, shape: 'conflicts' as const }
    const flagged = {
      ...qualityReview,
      issues: [{ code: 'opening_conflict' as const, detail: 'door', confidence: 0.9 }],
    }
    const result = planReviewMetrics([
      sample({ review: conflict, qualityReview: flagged }),
      sample({ review: conflict, qualityReview }),
      sample({ qualityReview: flagged }),
      sample({ projectId: 'another', roomId: 'another', roomKind: 'kitchen', qualityReview }),
      sample({ review: { ...review, openings: ['not_visible'] } }),
    ])
    expect(result).toMatchObject({
      saved: 5,
      compared: 4,
      projects: 2,
      rooms: 2,
      incomplete: 1,
      humanConflicts: 2,
      humanNoVisibleConflicts: 2,
      truePositive: 1,
      falseNegative: 1,
      falsePositive: 1,
      trueNegative: 1,
      byRoomKind: {
        living: { compared: 3, missed: 1, falseAlarms: 1 },
        kitchen: { compared: 1, missed: 0, falseAlarms: 0 },
      },
    })
  })

  it('excludes stale, edited and auto-unavailable pairs', () => {
    const result = planReviewMetrics([
      sample({ currentSourceHash: 'replaced' }),
      sample({ currentArchitecture: { shape: 'rectangular', openings: [] } }),
      sample({ usesEditedRender: true }),
      sample({ qualityReview: null }),
      sample({ qualityReview: { ...qualityReview, status: 'unavailable' } }),
      sample({ qualityReview: { ...qualityReview, architecture: undefined } }),
      sample({
        qualityReview: {
          ...qualityReview,
          architecture: { shape: 'nonrectangular', openings: [{ type: 'window', side: 'top' }] },
        },
      }),
    ])
    expect(result).toMatchObject({
      saved: 7,
      stale: 2,
      editedRender: 1,
      autoUnavailable: 2,
      autoArchitectureMissing: 2,
      compared: 0,
    })
  })

  it('compares opening facts regardless of their storage order', () => {
    const currentArchitecture = {
      shape: 'rectangular' as const,
      openings: [
        { type: 'door' as const, side: 'left' as const },
        { type: 'window' as const, side: 'top' as const },
      ],
    }
    const result = planReviewMetrics([
      sample({
        review: { ...review, openings: ['matches', 'matches'] },
        currentArchitecture,
        qualityReview: {
          ...qualityReview,
          architecture: {
            ...currentArchitecture,
            openings: [...currentArchitecture.openings].reverse(),
          },
        },
      }),
    ])
    expect(result).toMatchObject({ compared: 1, trueNegative: 1 })
  })

  it('counts visible opening conflicts even when another fact is not visible', () => {
    const result = planReviewMetrics([
      sample({ review: { ...review, shape: 'not_visible', openings: ['conflicts'] } }),
    ])
    expect(result).toMatchObject({ compared: 1, humanConflicts: 1, falseNegative: 1 })
  })

  it('does not count older labels with unassessed extra openings as clean', () => {
    const result = planReviewMetrics([
      sample({ review: { ...review, extraOpenings: undefined } }),
      sample({ review: { ...review, extraOpenings: 'conflicts' } }),
    ])
    expect(result).toMatchObject({
      compared: 1,
      incomplete: 1,
      humanConflicts: 1,
      falseNegative: 1,
    })
  })
})
