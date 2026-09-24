import type { ConceptPlanReview, ConceptQualityReview } from '@uyut/db'

export type PlanReviewSample = {
  projectId: string
  roomId: string
  review: ConceptPlanReview
  currentSourceHash: string | null
  expectedOpeningCount: number | null
  usesEditedRender: boolean
  qualityReview: ConceptQualityReview | null
}

export type PlanReviewMetrics = {
  saved: number
  stale: number
  editedRender: number
  incomplete: number
  autoUnavailable: number
  compared: number
  projects: number
  rooms: number
  humanConflicts: number
  humanNoVisibleConflicts: number
  truePositive: number
  falseNegative: number
  falsePositive: number
  trueNegative: number
}

/** Compare only current, original renders with a conclusive human architecture verdict. */
export function planReviewMetrics(samples: PlanReviewSample[]): PlanReviewMetrics {
  const metrics: PlanReviewMetrics = {
    saved: samples.length,
    stale: 0,
    editedRender: 0,
    incomplete: 0,
    autoUnavailable: 0,
    compared: 0,
    projects: 0,
    rooms: 0,
    humanConflicts: 0,
    humanNoVisibleConflicts: 0,
    truePositive: 0,
    falseNegative: 0,
    falsePositive: 0,
    trueNegative: 0,
  }
  const projects = new Set<string>()
  const rooms = new Set<string>()

  for (const sample of samples) {
    if (
      !sample.currentSourceHash ||
      sample.review.sourceHash !== sample.currentSourceHash ||
      sample.expectedOpeningCount !== sample.review.openings.length
    ) {
      metrics.stale++
      continue
    }
    if (sample.usesEditedRender) {
      metrics.editedRender++
      continue
    }

    const verdicts = [sample.review.shape, ...sample.review.openings]
    const hasConflict = verdicts.includes('conflicts')
    if (!hasConflict && !verdicts.every((verdict) => verdict === 'matches')) {
      metrics.incomplete++
      continue
    }
    const auto = sample.qualityReview
    if (!auto || auto.status === 'unavailable') {
      metrics.autoUnavailable++
      continue
    }

    metrics.compared++
    projects.add(sample.projectId)
    rooms.add(sample.roomId)
    const autoFlagsConflict = auto.issues.some((issue) => issue.code === 'opening_conflict')
    if (hasConflict) {
      metrics.humanConflicts++
      if (autoFlagsConflict) metrics.truePositive++
      else metrics.falseNegative++
    } else {
      metrics.humanNoVisibleConflicts++
      if (autoFlagsConflict) metrics.falsePositive++
      else metrics.trueNegative++
    }
  }

  metrics.projects = projects.size
  metrics.rooms = rooms.size
  return metrics
}
