import type { PlanPageContours, PlanReading } from '@uyut/db'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
} from './plan-page-review'
import type { PdfLinework } from './plan-pdf-linework'
import { PDF_NATIVE_MAX_PATHS, PDF_NATIVE_MAX_POINTS } from './plan-pdf-linework'
import { pairPlanPageOpeningFaces, verifyPlanPageOpeningFaces } from './plan-pdf-opening-faces'
import { type PdfPlanSource, pdfContourRoomNumbers } from './plan-pdf-room-binding'
import { classifyPlanPageWallSpans, type PdfWallCoverageSpan } from './plan-pdf-wall-coverage'
import {
  pairPlanPageWallFaces,
  validPlanPageWallSource,
  validPlanPageWallSourceForLocalAudit,
} from './plan-pdf-wall-faces'

export type ReviewedPageCoverage = {
  source: PdfPlanSource
  status: 'refused' | 'partial'
  refusalReason?: string
  extractionComplete: boolean
  floorBoundary: 'missing' | 'envelope-only' | 'reviewed-floor' | 'legacy-exterior-floor'
  missingSourceNumbers: number[]
  wallPairs: number
  wallSource: { strictValid: boolean; localAuditValid: boolean }
  wallSpans: Record<PdfWallCoverageSpan['status'], number>
  reviewSpans: PdfWallCoverageSpan[]
  reviewSpansTruncated: boolean
  openings: {
    declaredDoors: number
    doorPairCandidates: number
    pairedDoorFaces: number
    unresolvedDoorChecks: number
    ambiguousDoorChecks: number
    uncheckedDoorFaces: number
    nonDoorDeclarations: number
  }
  issues: string[]
  readiness: { readOnly: true; readyFor2D: false; readyFor3D: false }
}

/** Same-source diagnostics only. Declared closures and local pairs never certify a whole apartment. */
export function inspectReviewedPageCoverage(input: {
  source: PdfPlanSource
  reading: PlanReading
  contours: PlanPageContours
  linework: PdfLinework
}): ReviewedPageCoverage {
  const { source, reading, contours, linework } = input
  const report: ReviewedPageCoverage = {
    source: { ...source },
    status: 'refused',
    extractionComplete: false,
    floorBoundary: 'missing',
    missingSourceNumbers: [],
    wallPairs: 0,
    wallSource: { strictValid: false, localAuditValid: false },
    wallSpans: {
      paired: 0,
      opening: 0,
      unmatched: 0,
      'unpaired-exterior': 0,
      ambiguous: 0,
      'unsupported-angle': 0,
      conditional: 0,
    },
    reviewSpans: [],
    reviewSpansTruncated: false,
    openings: {
      declaredDoors: 0,
      doorPairCandidates: 0,
      pairedDoorFaces: 0,
      unresolvedDoorChecks: 0,
      ambiguousDoorChecks: 0,
      uncheckedDoorFaces: 0,
      nonDoorDeclarations: 0,
    },
    issues: [],
    readiness: { readOnly: true, readyFor2D: false, readyFor3D: false },
  }
  const refuse = (reason: string) => {
    report.refusalReason = reason
    report.issues.push(reason)
    return report
  }
  if (
    linework.paths.length > PDF_NATIVE_MAX_PATHS ||
    linework.paths.reduce((sum, path) => sum + path.points.length, 0) > PDF_NATIVE_MAX_POINTS ||
    reading.rooms.length > 100 ||
    contours.rooms.length > 100
  )
    return refuse('coverage-work-limit')
  if (source.state !== 'existing') return refuse('not-existing-state')
  if (!planPageContoursSchema.safeParse(contours).success) return refuse('invalid-room-contours')
  const sourceOnlyRooms = contours.rooms.filter((room) => room.sourceTopology !== undefined)
  // Paint topology is a saved source guide, not a reviewed physical room. Keep
  // its page-wide boundary out of the local physical diagnostics as well.
  const physicalContours: PlanPageContours = sourceOnlyRooms.length
    ? {
        ...contours,
        rooms: contours.rooms.filter((room) => room.sourceTopology === undefined),
        exterior: undefined,
        floor: undefined,
        voids: undefined,
      }
    : contours
  // Always check overlaps, including legacy polygon-only reviews.
  const issue =
    planPageFeaturesIssue(physicalContours, { checkRoomOverlap: true }) ??
    planPageReviewIssue(physicalContours, reading, source, linework)
  if (issue) return refuse(issue)
  const sourceNumbers = reading.rooms.map((room) => room.sourceNumber)
  if (
    sourceNumbers.some((number) => !isPlanRoomSourceNumber(number)) ||
    new Set(sourceNumbers).size !== sourceNumbers.length
  )
    return refuse('incomplete-room-identity-inventory')
  const declaredNumbers = new Set(
    contours.rooms.flatMap((room) => [...pdfContourRoomNumbers(room)]),
  )
  report.missingSourceNumbers = sourceNumbers.filter(
    (number): number is number => number !== undefined && !declaredNumbers.has(number),
  )
  report.status = 'partial'
  if (sourceOnlyRooms.length) report.issues.push('source-areas-held')
  if (!physicalContours.rooms.length) report.issues.push('no-physical-room-contours')
  report.extractionComplete =
    !linework.truncated &&
    linework.skippedCurves === 0 &&
    linework.clippedPaths === 0 &&
    linework.unsupportedPaths === 0 &&
    linework.unsupportedContexts === 0
  report.floorBoundary = physicalContours.floor
    ? 'reviewed-floor'
    : physicalContours.exterior?.boundaryRole === 'outer-wall-envelope'
      ? 'envelope-only'
      : physicalContours.exterior
        ? physicalContours.exterior.boundaryRole === 'floor'
          ? 'reviewed-floor'
          : 'legacy-exterior-floor'
        : 'missing'
  report.wallSource = {
    strictValid: validPlanPageWallSource(linework, source, physicalContours),
    localAuditValid: validPlanPageWallSourceForLocalAudit(linework, source, physicalContours),
  }
  const pairs = pairPlanPageWallFaces(linework, source, physicalContours)
  const spans = classifyPlanPageWallSpans(physicalContours, pairs)
  report.wallPairs = pairs.length
  for (const span of spans) report.wallSpans[span.status]++
  const reviewSpans = spans.filter((span) =>
    ['unmatched', 'unpaired-exterior', 'ambiguous', 'unsupported-angle', 'conditional'].includes(
      span.status,
    ),
  )
  report.reviewSpans = reviewSpans.slice(0, 200).map((span) => ({
    ...span,
    start: { ...span.start },
    end: { ...span.end },
  }))
  report.reviewSpansTruncated = reviewSpans.length > report.reviewSpans.length
  const openings = physicalContours.rooms.flatMap((room) => room.openings ?? [])
  const checks = verifyPlanPageOpeningFaces(linework, source, physicalContours)
  const openingPairs = pairPlanPageOpeningFaces(linework, source, physicalContours)
  report.openings = {
    declaredDoors: openings.filter((opening) => opening.kind === 'door').length,
    doorPairCandidates: openingPairs.length,
    pairedDoorFaces: openingPairs.length * 2,
    unresolvedDoorChecks: checks.filter((check) => check.status === 'unresolved').length,
    ambiguousDoorChecks: checks.filter((check) => check.status === 'ambiguous').length,
    uncheckedDoorFaces:
      openings.filter((opening) => opening.kind === 'door').length - checks.length,
    nonDoorDeclarations: openings.filter((opening) => opening.kind !== 'door').length,
  }
  if (!report.extractionComplete) report.issues.push('native-extraction-incomplete')
  if (!report.wallSource.localAuditValid) report.issues.push('wall-pairing-source-unavailable')
  if (
    physicalContours.rooms.reduce(
      (sum, room) => sum + room.polygon.length,
      physicalContours.exterior?.polygon.length ?? 0,
    ) > 200
  )
    report.issues.push('wall-pairing-edge-limit')
  if (report.missingSourceNumbers.length) report.issues.push('room-inventory-partial')
  if (['missing', 'envelope-only'].includes(report.floorBoundary))
    report.issues.push('floor-boundary-missing')
  if (reviewSpans.length) report.issues.push('wall-span-coverage-partial')
  if (report.wallSpans.conditional) report.issues.push('conditional-boundary-review-required')
  if (report.reviewSpansTruncated) report.issues.push('review-spans-display-limited')
  if (report.openings.declaredDoors !== report.openings.pairedDoorFaces)
    report.issues.push('door-face-pairing-partial')
  if (report.openings.nonDoorDeclarations) report.issues.push('non-door-declarations-unverified')
  // These independent checks are not performed by the source-space report.
  report.issues.push(
    'floor-area-partition-unverified',
    'complete-opening-inventory-unverified',
    'physical-passages-unverified',
    'metric-scale-unverified',
    'vertical-data-unverified',
  )
  return report
}
