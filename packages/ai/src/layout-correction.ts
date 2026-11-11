import type { ConceptQualityReview } from '@uyut/db'

function hasCompleteReview(review: ConceptQualityReview): boolean {
  return (
    review.status !== 'unavailable' &&
    review.imageReview !== 'limited' &&
    review.sourceComparison !== 'limited' &&
    review.sourceComparison !== 'unavailable'
  )
}

/**
 * One narrowly scoped edit for a visible item missing from an otherwise valid render.
 * The contract stays authoritative; the review only tells the editor what was not confirmed.
 */
export function layoutCorrectionPrompt(
  review: ConceptQualityReview,
  layoutContract: string | null | undefined,
): string | null {
  const contract = layoutContract?.trim()
  if (!contract || review.status !== 'review' || !hasCompleteReview(review)) return null
  if (review.issues.length !== 1 || review.issues[0]?.code !== 'requirement_unconfirmed')
    return null

  return [
    'The attached image is the current render of this same room.',
    'Correct only the missing verified-layout requirement described below.',
    `Checker report: ${JSON.stringify(review.issues[0].detail)}.`,
    `Verified layout contract: ${contract}`,
    'Make the missing furniture type unmistakably and fully visible in its contracted position.',
    'Never fake the requirement by adding doors to, relabelling or restyling an existing low cabinet in the foreground.',
    'If the report names a wardrobe, show that furniture type clearly; a low sideboard, dresser or foreground cabinet is not a wardrobe.',
    'Preserve every stated furniture height from the contract. Do not extend furniture to the ceiling or infer its height from its type when the height is unknown.',
    'Keep the entrance, every opening and the continuous walking route visibly clear; do not place the corrected item in the doorway or foreground passage.',
    'Keep exactly the same camera, walls, ceiling, floor, windows, doors, lighting, finishes and all already-correct furniture.',
    'Do not redesign the room, add another opening, substitute a different furniture type or move compliant objects.',
  ].join(' ')
}

/** A paid correction is kept only when it removes the missing requirement without new issues. */
export function isLayoutCorrectionImprovement(
  before: ConceptQualityReview,
  after: ConceptQualityReview,
): boolean {
  return (
    hasCompleteReview(before) &&
    hasCompleteReview(after) &&
    before.status === 'review' &&
    before.issues.length === 1 &&
    before.issues[0]?.code === 'requirement_unconfirmed' &&
    after.status === 'checked' &&
    after.issues.length === 0
  )
}
