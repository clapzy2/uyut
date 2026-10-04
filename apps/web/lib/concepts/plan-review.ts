import type { ConceptQualityReview } from '@uyut/db'

export { conceptPlanReviewSource as planReviewSource } from '@uyut/ai'

export type QualityPlanStatus = 'current' | 'changed' | 'unlinked'

/** A review becomes stale after replacing the plan, editing its geometry, or changing the render. */
export function qualityReviewPlanStatus(
  review: ConceptQualityReview | null,
  currentSourceHash: string | null,
): QualityPlanStatus | null {
  if (!review) return null
  if (review.architectureSourceHash) {
    return review.architectureSourceHash === currentSourceHash ? 'current' : 'changed'
  }
  return review.architecture || currentSourceHash ? 'unlinked' : null
}
