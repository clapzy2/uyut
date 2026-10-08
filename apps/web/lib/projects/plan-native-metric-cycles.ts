import type { PlanPageSegmentRef } from '@uyut/db'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import type { nativeFaceCycle } from './plan-native-face-cycle'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { nativePageSegments } from './plan-pdf-opening-endpoint'
import { type PdfPlanSource, pdfPolygonIsValid } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

type Cycle = Extract<ReturnType<typeof nativeFaceCycle>, { status: 'candidate' }>
type Ref = PlanPageSegmentRef
const refKey = (ref: Ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
const CONNECTION_TOLERANCE_POINTS = 0.12
const DIMENSION_TOLERANCE_MM = 2
export type ReviewedMetricAnchors = {
  review: 'manual-native-metric-review'
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  origin: PagePoint
  anchors: { chainId: string; cycleId: string; faceRef: Ref; witnessRefs: [Ref, Ref] }[]
}

/** Common printed-page scale for reviewed cycles; no confirmation or site measurements. */
export function metricNativeCycles(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  dimensions: ReturnType<typeof nativeDimensionEvidence>
  cycles: { id: string; cycle: Cycle }[]
  reviewed: ReviewedMetricAnchors
}) {
  const { native, work, dimensions, cycles, reviewed } = input
  const fail = (reason: string) => ({ status: 'unresolved' as const, reason, contours: [] })
  for (const source of [input.lineworkSource, dimensions.rasterSource, reviewed.rasterSource])
    bindObservedRegionLabels({
      regionSource: native.source,
      labelSource: source,
      regions: [],
      labels: [],
    })
  const matchesSource = (source: PdfPlanSource) =>
    source.sha256 === native.originalPdfSha256 &&
    source.pdfPage === native.source.page &&
    source.state === 'existing'
  if (
    reviewed.review !== 'manual-native-metric-review' ||
    !native.complete ||
    !native.originalPdfSha256 ||
    !/^[a-f0-9]{64}$/.test(native.originalPdfSha256) ||
    !matchesSource(reviewed.source) ||
    !matchesSource(dimensions.source) ||
    dimensions.status !== 'draft' ||
    dimensions.chains.length > 8 ||
    cycles.length < 1 ||
    cycles.length > 4 ||
    reviewed.anchors.length < 2 ||
    reviewed.anchors.length > 8 ||
    new Set(cycles.map((entry) => entry.id)).size !== cycles.length ||
    cycles.some(
      (entry) =>
        !entry.id.trim() ||
        entry.id !== entry.id.trim() ||
        entry.id.length > 120 ||
        entry.cycle.status !== 'candidate' ||
        !matchesSource(entry.cycle.source) ||
        !pdfPolygonIsValid(entry.cycle.polygon),
    ) ||
    ![reviewed.origin.x, reviewed.origin.y].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
    ) ||
    work.coordinateSystem !== 'page-0-1000' ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0) ||
    work.paths.length > 3000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000
  )
    throw new Error('Invalid source-bound metric review')
  const physical = (point: PagePoint) => ({
    x: (point.x / 1000) * work.pageWidth,
    y: (point.y / 1000) * work.pageHeight,
  })
  const segments = nativePageSegments(work)
  const usedChains = new Set<string>(),
    usedLabels = new Set<number>(),
    usedRails = new Set<number>()
  const usedFaces = new Set<string>(),
    usedWitnesses = new Set<string>()
  const anchors: {
    cycleId: string
    chainId: string
    mm: number
    lengthPoints: number
    faceLengthPoints: number
    direction: PagePoint
    faceRef: Ref
    witnessRefs: [Ref, Ref]
    labelIndexes: number[]
    lineOperations: number[]
  }[] = []
  for (const anchor of reviewed.anchors) {
    const cycle = cycles.find((entry) => entry.id === anchor.cycleId)?.cycle
    const matches = dimensions.chains.filter((chain) => chain.id === anchor.chainId)
    const chain = matches[0]
    if (!cycle || matches.length !== 1 || !chain || chain.result.status !== 'candidate')
      return fail('missing-anchor-cycle-or-dimension')
    const faces = cycle.faces.filter(
      (face) => face.ref && refKey(face.ref) === refKey(anchor.faceRef),
    )
    const face = faces[0]
    const endpoints = face?.endpoints
    if (
      faces.length !== 1 ||
      !endpoints ||
      endpoints.length !== 2 ||
      !endpoints[0] ||
      !endpoints[1]
    )
      return fail('missing-reviewed-anchor-face')
    if (
      ![endpoints[0], endpoints[1], ...chain.result.ends].every((point) =>
        [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000),
      ) ||
      !Number.isSafeInteger(chain.result.totalMm) ||
      chain.result.totalMm <= 0
    )
      return fail('invalid-anchor-measurement-or-points')
    if (
      usedChains.has(chain.id) ||
      chain.result.labelIndexes.some((index) => usedLabels.has(index)) ||
      chain.result.lineOperations.some((operation) => usedRails.has(operation)) ||
      usedFaces.has(refKey(anchor.faceRef)) ||
      anchor.witnessRefs.length !== 2 ||
      anchor.witnessRefs.some((ref) => usedWitnesses.has(refKey(ref))) ||
      refKey(anchor.witnessRefs[0]) === refKey(anchor.witnessRefs[1])
    )
      return fail('reused-calibration-evidence')
    const start = physical(chain.result.ends[0]),
      end = physical(chain.result.ends[1])
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (!Number.isFinite(length) || length <= 0) return fail('degenerate-calibration-span')
    const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length }
    const project = (point: PagePoint) => {
      const p = physical(point)
      return {
        along: (p.x - start.x) * direction.x + (p.y - start.y) * direction.y,
        across: -(p.x - start.x) * direction.y + (p.y - start.y) * direction.x,
      }
    }
    const ordered = [endpoints[0], endpoints[1]].sort((a, b) => project(a).along - project(b).along)
    const first = ordered[0],
      last = ordered[1]
    if (!first || !last) return fail('missing-face-endpoints')
    const low = project(first),
      high = project(last)
    if (
      Math.abs(low.along) > CONNECTION_TOLERANCE_POINTS ||
      Math.abs(high.along - length) > CONNECTION_TOLERANCE_POINTS ||
      Math.abs(low.across - high.across) > CONNECTION_TOLERANCE_POINTS ||
      Math.abs(low.across) <= CONNECTION_TOLERANCE_POINTS
    )
      return fail('dimension-does-not-span-source-face')
    for (const [index, vertex] of [first, last].entries()) {
      const ref = anchor.witnessRefs[index]
      const candidates = segments.filter((segment) => ref && refKey(segment) === refKey(ref))
      const witness = candidates[0]
      if (candidates.length !== 1 || !witness) return fail('missing-or-ambiguous-native-witness')
      const a = project(witness.start),
        b = project(witness.end),
        corner = project(vertex)
      if (
        Math.abs(a.along - corner.along) > CONNECTION_TOLERANCE_POINTS ||
        Math.abs(b.along - corner.along) > CONNECTION_TOLERANCE_POINTS ||
        Math.abs(a.across - b.across) <= CONNECTION_TOLERANCE_POINTS ||
        ![corner.across, 0].every(
          (value) => value >= Math.min(a.across, b.across) && value <= Math.max(a.across, b.across),
        )
      )
        return fail('unbounded-or-wrong-endpoint-witness')
    }
    usedChains.add(chain.id)
    for (const index of chain.result.labelIndexes) usedLabels.add(index)
    for (const operation of chain.result.lineOperations) usedRails.add(operation)
    usedFaces.add(refKey(anchor.faceRef))
    for (const ref of anchor.witnessRefs) usedWitnesses.add(refKey(ref))
    const a = physical(first),
      b = physical(last)
    anchors.push({
      cycleId: anchor.cycleId,
      chainId: chain.id,
      mm: chain.result.totalMm,
      lengthPoints: length,
      faceLengthPoints: Math.hypot(b.x - a.x, b.y - a.y),
      direction,
      faceRef: anchor.faceRef,
      witnessRefs: anchor.witnessRefs,
      labelIndexes: chain.result.labelIndexes,
      lineOperations: chain.result.lineOperations,
    })
  }
  for (const entry of cycles) {
    const local = anchors.filter((anchor) => anchor.cycleId === entry.id)
    if (
      !local.some((a, index) =>
        local
          .slice(index + 1)
          .some(
            (b) => Math.abs(a.direction.x * b.direction.y - a.direction.y * b.direction.x) >= 0.5,
          ),
      )
    )
      return fail('two-independent-directions-required-per-contour')
  }
  const primary = anchors[0]
  if (!primary) return fail('no-calibration-anchor')
  const cmPerPoint = primary.mm / primary.lengthPoints / 10
  if (!Number.isFinite(cmPerPoint) || cmPerPoint <= 0) return fail('invalid-common-scale')
  if (
    anchors.some(
      (anchor) =>
        Math.abs(anchor.lengthPoints * cmPerPoint * 10 - anchor.mm) > DIMENSION_TOLERANCE_MM ||
        Math.abs(anchor.faceLengthPoints * cmPerPoint * 10 - anchor.mm) > DIMENSION_TOLERANCE_MM,
    )
  )
    return fail('common-scale-conflict')
  const origin = physical(reviewed.origin)
  const pageSizeCm = { width: work.pageWidth * cmPerPoint, height: work.pageHeight * cmPerPoint }
  if (![pageSizeCm.width, pageSizeCm.height].every((value) => Number.isFinite(value) && value > 0))
    return fail('non-finite-metric-frame')
  const contours = cycles.map((entry) => {
    const polygonCm = entry.cycle.polygon.map((point) => {
      const p = physical(point)
      return { xCm: (p.x - origin.x) * cmPerPoint, yCm: (p.y - origin.y) * cmPerPoint }
    })
    const areaM2 =
      Math.abs(
        polygonCm.reduce((sum, point, index) => {
          const next = polygonCm[(index + 1) % polygonCm.length]
          return next ? sum + point.xCm * next.yCm - next.xCm * point.yCm : sum
        }, 0),
      ) / 20_000
    return { id: entry.id, polygonCm, areaM2 }
  })
  if (
    contours.some(
      (contour) =>
        !Number.isFinite(contour.areaM2) ||
        contour.areaM2 <= 0 ||
        contour.polygonCm.some(
          (point) => !Number.isFinite(point.xCm) || !Number.isFinite(point.yCm),
        ),
    )
  )
    return fail('invalid-metric-contour')
  return {
    status: 'draft' as const,
    source: reviewed.source,
    cmPerPoint,
    origin: { ...reviewed.origin },
    connectionTolerancePoints: CONNECTION_TOLERANCE_POINTS,
    dimensionToleranceMm: DIMENSION_TOLERANCE_MM,
    anchors,
    contours,
    pageSizeCm,
  }
}
