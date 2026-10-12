import type { PlanPageContours, PlanPageRoomIdentity, PlanReading } from '@uyut/db'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import { nativeFaceCycle, type ReviewedNativeFaces } from './plan-native-face-cycle'
import { type NativeRoomContacts, nativeRoomContacts } from './plan-native-room-contacts'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
} from './plan-page-review'
import type { PdfLinework } from './plan-pdf-linework'
import { type PdfPlanSource, pdfContourRoomNumbers } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

export type NativePageContourCandidates = {
  status: 'candidate' | 'partial' | 'unresolved'
  reason?: string
  contours: Omit<PlanPageContours, 'review'> | null
  roomContacts: NativeRoomContacts | null
  missingSourceNumbers: number[]
  issues: string[]
  readiness: { readOnly: true; readyFor2D: false; readyFor3D: false }
}

/** Explicit assignments, not printed-caption ownership or a saved review.
 * A separately selected floor requires a separately selected outer-wall envelope.
 */
export function nativePageContourCandidates(input: {
  source: PdfPlanSource
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  dimensions: ReturnType<typeof nativeDimensionEvidence>
  reading: Pick<PlanReading, 'rooms' | 'sourcePage' | 'planState'>
  rooms: { identity: PlanPageRoomIdentity; reviewed: ReviewedNativeFaces }[]
  floor?: ReviewedNativeFaces
  exterior?: ReviewedNativeFaces
}): NativePageContourCandidates {
  const { source, native, work, reading } = input
  const fail = (reason: string): NativePageContourCandidates => ({
    status: 'unresolved',
    reason,
    contours: null,
    roomContacts: null,
    missingSourceNumbers: [],
    issues: [reason],
    readiness: { readOnly: true, readyFor2D: false, readyFor3D: false },
  })
  if (
    source.state !== 'existing' ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    source.sha256 !== native.originalPdfSha256 ||
    source.pdfPage !== native.source.page ||
    reading.sourcePage !== source.pdfPage ||
    reading.planState !== 'existing'
  )
    return fail('different-reading-source')
  if (!native.complete) return fail('native-text-incomplete')
  const reviews = [
    ...input.rooms.map((room) => room.reviewed),
    ...(input.floor ? [input.floor] : []),
    ...(input.exterior ? [input.exterior] : []),
  ]
  if (
    input.rooms.length < 1 ||
    input.rooms.length > 100 ||
    reading.rooms.length > 100 ||
    reviews.some((review) => review.faces.length < 3 || review.faces.length > 100) ||
    reviews.reduce((sum, review) => sum + review.faces.length, 0) > 500
  )
    return fail('native-page-assignment-limit')
  if (input.floor && !input.exterior) return fail('floor-requires-outer-wall-envelope')
  const sourceNumbers = reading.rooms.map((room) => room.sourceNumber)
  if (
    sourceNumbers.some((number) => !isPlanRoomSourceNumber(number)) ||
    new Set(sourceNumbers).size !== sourceNumbers.length
  )
    return fail('incomplete-room-identity-inventory')
  for (const review of reviews) {
    if (
      review.review !== 'manual-native-face-review' ||
      review.source.sha256 !== source.sha256 ||
      review.source.pdfPage !== source.pdfPage ||
      review.source.state !== source.state
    )
      return fail('different-face-review-source')
  }
  const dimensions = input.dimensions
  if (
    dimensions.status !== 'draft' ||
    dimensions.source?.sha256 !== source.sha256 ||
    dimensions.source.pdfPage !== source.pdfPage ||
    dimensions.source.state !== 'existing' ||
    !Array.isArray(dimensions.dimensionOperations) ||
    dimensions.dimensionOperations.length > 160
  )
    return fail('different-dimension-source')
  // This catch is limited to the existing frame validator, not cycle construction.
  try {
    for (const frame of [
      input.lineworkSource,
      dimensions.rasterSource,
      ...reviews.map((review) => review.rasterSource),
    ])
      bindObservedRegionLabels({
        regionSource: native.source,
        labelSource: frame,
        regions: [],
        labels: [],
      })
  } catch {
    return fail('different-raster-source')
  }
  const candidate: Omit<PlanPageContours, 'review'> = {
    source: { sha256: source.sha256, pdfPage: source.pdfPage, state: source.state },
    coordinateSystem: 'page-0-1000',
    pageWidth: work.pageWidth,
    pageHeight: work.pageHeight,
    rooms: [],
  }
  const build = (reviewed: ReviewedNativeFaces) =>
    nativeFaceCycle({
      native,
      work,
      lineworkSource: input.lineworkSource,
      dimensions: input.dimensions,
      reviewed,
    })
  const untypedClosures = reviews.reduce(
    (sum, review) =>
      sum + review.faces.filter((face) => face.kind === 'reviewed-opening-boundary').length,
    0,
  )
  for (const room of input.rooms) {
    const cycle = build(room.reviewed)
    if (cycle.status !== 'candidate') return fail(`room-cycle:${cycle.reason}`)
    candidate.rooms.push({
      ...structuredClone(room.identity),
      polygon: cycle.polygon,
      vertexProofs: cycle.vertexProofs,
    })
  }
  if (input.exterior) {
    const cycle = build(input.exterior)
    if (cycle.status !== 'candidate') return fail(`exterior-cycle:${cycle.reason}`)
    candidate.exterior = {
      polygon: cycle.polygon,
      vertexProofs: cycle.vertexProofs,
      boundaryRole: 'outer-wall-envelope',
    }
  }
  if (input.floor) {
    const cycle = build(input.floor)
    if (cycle.status !== 'candidate') return fail(`floor-cycle:${cycle.reason}`)
    candidate.floor = { polygon: cycle.polygon, vertexProofs: cycle.vertexProofs }
  }
  // Existing validators require a review marker. This projection is validation-only:
  // it is never returned, saved, or attached to a reading. Output still has no review.
  const projection = { ...candidate, review: 'manual-source-review' as const }
  const validated = planPageContoursSchema.safeParse(projection)
  if (!validated.success)
    return fail(
      validated.error.issues.find((issue) => issue.code === 'custom')?.message ??
        'invalid-native-room-assignment',
    )
  const issue =
    planPageFeaturesIssue(projection, { checkRoomOverlap: true }) ??
    planPageReviewIssue(projection, reading, source, work)
  if (issue) return fail(issue)
  const roomContacts = nativeRoomContacts(candidate)
  if (roomContacts.status === 'unresolved') return fail(`room-contacts:${roomContacts.reason}`)
  const assigned = new Set(candidate.rooms.flatMap((room) => [...pdfContourRoomNumbers(room)]))
  const missingSourceNumbers = sourceNumbers.filter(
    (number): number is number => number !== undefined && !assigned.has(number),
  )
  const issues = [
    'complete-floor-coverage-unverified',
    'complete-opening-inventory-unverified',
    'metric-scale-unverified',
    'vertical-data-unverified',
    'shared-boundaries-not-physical-passages',
  ]
  if (missingSourceNumbers.length) issues.push('room-inventory-partial')
  if (!candidate.floor) issues.push('floor-boundary-missing')
  if (!candidate.exterior) issues.push('outer-wall-envelope-missing')
  if (untypedClosures) issues.push('opening-closures-untyped')
  if (work.skippedCurves || work.clippedPaths) issues.push('native-extraction-incomplete')
  if (roomContacts.truncated) issues.push('room-contacts-display-limited')
  return {
    status:
      missingSourceNumbers.length ||
      !candidate.floor ||
      work.skippedCurves ||
      work.clippedPaths ||
      roomContacts.truncated
        ? 'partial'
        : 'candidate',
    contours: candidate,
    roomContacts,
    missingSourceNumbers,
    issues,
    readiness: { readOnly: true, readyFor2D: false, readyFor3D: false },
  }
}
