import type { PlanPageSegmentRef } from '@uyut/db'
import type { NativeTextAnchors } from './plan-document'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import { nativeStrokeFaceCandidates } from './plan-native-stroke-candidates'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { nativePageSegments } from './plan-pdf-opening-endpoint'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

type SourceStroke = { ref: PlanPageSegmentRef; start: PagePoint; end: PagePoint }
export type ReviewedNativeAnnotations = {
  review: 'manual-native-annotation-review'
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  /** Declared walls are not a claim of a complete wall inventory. */
  walls: SourceStroke[]
  exclusions: (SourceStroke & {
    role: 'dimension-rail' | 'dimension-tick'
    label: { id: string; text: string; pagePoint: PagePoint; rotation: number }
    valueMm: number
  })[]
}
const refKey = (ref: PlanPageSegmentRef) =>
  `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
function overlaps(a: SourceStroke, b: SourceStroke) {
  const cross = (point: PagePoint) =>
    (a.end.x - a.start.x) * (point.y - a.start.y) - (a.end.y - a.start.y) * (point.x - a.start.x)
  if (cross(b.start) !== 0 || cross(b.end) !== 0) return false
  const axis = Math.abs(a.end.x - a.start.x) >= Math.abs(a.end.y - a.start.y) ? 'x' : 'y'
  return (
    Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis])) >
    Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis]))
  )
}

/** Explicit partial annotation review; never mutates the source or confirms floor geometry. */
export function reviewedNativeAnnotationFaces(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  reviewed: ReviewedNativeAnnotations
}) {
  const { native, work, reviewed } = input
  const fail = (reason: string) => ({
    status: 'unresolved' as const,
    reason,
    faces: null,
    excluded: [],
  })
  if (
    reviewed.review !== 'manual-native-annotation-review' ||
    reviewed.source.sha256 !== native.originalPdfSha256 ||
    reviewed.source.pdfPage !== native.source.page ||
    reviewed.source.state !== 'existing'
  )
    return fail('annotation-review-source-mismatch')
  bindObservedRegionLabels({
    regionSource: native.source,
    labelSource: reviewed.rasterSource,
    regions: [],
    labels: [],
  })
  if (
    reviewed.exclusions.length > 200 ||
    reviewed.walls.length > 3000 ||
    new Set(reviewed.exclusions.map((item) => refKey(item.ref))).size !==
      reviewed.exclusions.length ||
    new Set(reviewed.walls.map((item) => refKey(item.ref))).size !== reviewed.walls.length
  )
    return fail('invalid-annotation-review-inventory')
  const roles = automaticNativeDimensionRoles({ ...input, source: reviewed.source })
  if (roles.refusalReason) return fail(roles.refusalReason)
  const segments = new Map(nativePageSegments(work).map((segment) => [refKey(segment), segment]))
  const matchesSource = (item: SourceStroke) => {
    if (
      ![item.ref.operationIndex, item.ref.subpathIndex, item.ref.segmentIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      return false
    const original = segments.get(refKey(item.ref))
    return !!original && samePoint(original.start, item.start) && samePoint(original.end, item.end)
  }
  if (reviewed.walls.some((wall) => !matchesSource(wall))) return fail('stale-reviewed-wall')
  const excludedPathKeys = new Set<string>()
  for (const exclusion of reviewed.exclusions) {
    if (!matchesSource(exclusion)) return fail('stale-reviewed-annotation')
    if (
      reviewed.walls.some(
        (wall) => refKey(wall.ref) === refKey(exclusion.ref) || overlaps(wall, exclusion),
      )
    )
      return fail('annotation-wall-role-conflict')
    const label = native.labels.find((label) => label.id === exclusion.label.id)
    if (
      !label?.pagePoint ||
      label.name !== exclusion.label.text ||
      label.rotation !== exclusion.label.rotation ||
      !samePoint(label.pagePoint, exclusion.label.pagePoint)
    )
      return fail('stale-reviewed-dimension-label')
    const candidate = roles.candidates.find(
      (candidate) =>
        candidate.labelId === exclusion.label.id && candidate.valueMm === exclusion.valueMm,
    )
    const supported =
      candidate &&
      (exclusion.role === 'dimension-rail'
        ? [candidate.rail]
        : exclusion.role === 'dimension-tick'
          ? candidate.ticks
          : []
      ).some((segment) => refKey(segment) === refKey(exclusion.ref))
    if (!supported) return fail('unsupported-annotation-role')
    const path = work.paths.find(
      (path) =>
        path.operationIndex === exclusion.ref.operationIndex &&
        path.subpathIndex === exclusion.ref.subpathIndex,
    )
    if (
      path?.paint !== 'stroke' ||
      path.closed ||
      path.points.length !== 2 ||
      exclusion.ref.segmentIndex !== 0
    )
      return fail('annotation-is-not-a-single-open-stroke')
    excludedPathKeys.add(`${path.operationIndex}:${path.subpathIndex}`)
  }
  const filteredWork = {
    ...work,
    paths: work.paths.filter(
      (path) => !excludedPathKeys.has(`${path.operationIndex}:${path.subpathIndex}`),
    ),
  }
  const faces = nativeStrokeFaceCandidates({
    native,
    work: filteredWork,
    lineworkSource: input.lineworkSource,
  })
  return {
    status: 'draft' as const,
    source: reviewed.source,
    rasterSource: native.source,
    basis: 'partially-reviewed-native-annotation-exclusions' as const,
    excluded: reviewed.exclusions.map((entry) => structuredClone(entry)),
    originalPathCount: work.paths.length,
    searchedPathCount: filteredWork.paths.length,
    faces,
    completeAnnotationInventory: false as const,
    confirmsFloorGeometry: false as const,
  }
}
