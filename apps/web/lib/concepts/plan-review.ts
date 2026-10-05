import type { RoomArchitecture } from '@uyut/ai'
import type { ConceptQualityReview } from '@uyut/db'

export { conceptPlanReviewSource as planReviewSource } from '@uyut/ai'

export type QualityPlanStatus = 'current' | 'changed' | 'unlinked'

/** A review becomes stale after replacing the plan, editing its geometry, or changing the render. */
export function qualityReviewPlanStatus(
  review: ConceptQualityReview | null,
  currentSourceHash: string | null,
  currentArchitecture?: RoomArchitecture | null,
): QualityPlanStatus | null {
  if (!review) return null
  if (review.architectureSourceHash) {
    // Исправление извлечения проёмов может изменить факты без изменения самого
    // файла плана. Старую автосверку тогда нельзя показывать как актуальную.
    const factsChanged =
      currentArchitecture &&
      (review.architecture?.shape !== currentArchitecture.shape ||
        JSON.stringify(
          review.architecture?.openings.map((opening) => `${opening.type}:${opening.side}`).sort(),
        ) !==
          JSON.stringify(
            currentArchitecture.openings.map((opening) => `${opening.type}:${opening.side}`).sort(),
          ))
    return review.architectureSourceHash === currentSourceHash && !factsChanged
      ? 'current'
      : 'changed'
  }
  return review.architecture || currentSourceHash ? 'unlinked' : null
}
