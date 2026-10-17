import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import {
  createPdfNativePageDimensionChainVerifier,
  nativeDimensionMillimetres,
} from './plan-pdf-dimension-chain'
import type { PdfLinework } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import { type PdfPlanSource, pdfPointDistance } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

const MAX_DISCOVERY_WORK = 4_000_000

/** Printed dimension role candidates only; never permission to erase source strokes. */
export function automaticNativeDimensionRoles(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  source: PdfPlanSource
}) {
  const { native, work, source } = input
  const inventory = nativeFillCandidates(input)
  const candidates: {
    labelId: string
    valueMm: number
    axis: 'width' | 'depth'
    rail: NativePageSegment
    spanEnds: [{ x: number; y: number }, { x: number; y: number }]
    ticks: NativePageSegment[]
  }[] = []
  const unresolved: { labelId: string; reason: string }[] = []
  const result = (reason: string | null) => ({
    status: 'draft' as const,
    basis: 'native-printed-dimension-role-candidates' as const,
    source: { ...source },
    rasterSource: { ...native.source },
    candidates: reason ? [] : structuredClone(candidates),
    unresolved: reason ? [] : structuredClone(unresolved),
    refusalReason: reason,
    mayEraseSourceStrokes: false as const,
  })
  if (
    source.state !== 'existing' ||
    source.sha256 !== native.originalPdfSha256 ||
    source.pdfPage !== native.source.page
  )
    return result('unverified-or-mismatched-page-state')
  const scale = native.pageNormalizedScale
  if (
    inventory.refusalReason === 'incomplete-native-layer' ||
    !native.complete ||
    !scale ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0)
  )
    return result('incomplete-native-layer')
  if (
    native.labels.length > 1000 ||
    new Set(native.labels.map((label) => label.id)).size !== native.labels.length ||
    native.labels.some(
      (label) =>
        !Number.isSafeInteger(label.nativeIndex) ||
        (label.nativeIndex ?? -1) < 0 ||
        label.id !== `native-text-${label.nativeIndex}` ||
        !label.name ||
        label.name.length > 200 ||
        label.name !== label.name.trim() ||
        !label.pagePoint ||
        !Number.isFinite(label.rotation) ||
        [label.pagePoint.x, label.pagePoint.y].some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1000,
        ) ||
        Math.abs(label.point.x - label.pagePoint.x * scale.x) > 1e-6 ||
        Math.abs(label.point.y - label.pagePoint.y * scale.y) > 1e-6 ||
        ![label.point.x, label.point.y].every(Number.isFinite),
    )
  )
    return result('invalid-native-text-provenance')
  if (
    new Set(work.paths.map((path) => `${path.operationIndex}:${path.subpathIndex}`)).size !==
      work.paths.length ||
    work.paths.some(
      (path) =>
        ![path.operationIndex, path.subpathIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        path.points.some((point) =>
          [point.x, point.y].some((value) => !Number.isFinite(value) || value < 0 || value > 1000),
        ),
    )
  )
    return result('invalid-native-path-provenance')
  const labels = native.labels.filter(
    (label) => nativeDimensionMillimetres(label.name) !== undefined,
  )
  const segments = nativePageSegments(work)
  const pathByRef = new Map(
    work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const pathsByOperation = new Map<number, typeof work.paths>()
  const segmentsByOperation = new Map<number, NativePageSegment[]>()
  for (const path of work.paths) {
    const matches = pathsByOperation.get(path.operationIndex) ?? []
    matches.push(path)
    pathsByOperation.set(path.operationIndex, matches)
  }
  for (const segment of segments) {
    const matches = segmentsByOperation.get(segment.operationIndex) ?? []
    matches.push(segment)
    segmentsByOperation.set(segment.operationIndex, matches)
  }
  const tickSources = segments.filter((segment) => {
    const path = pathByRef.get(`${segment.operationIndex}:${segment.subpathIndex}`)
    if (!path || path.closed || path.paint !== 'stroke' || path.points.length !== 2) return false
    const dx = ((segment.end.x - segment.start.x) * work.pageWidth) / 1000
    const dy = ((segment.end.y - segment.start.y) * work.pageHeight) / 1000
    const length = Math.hypot(dx, dy)
    return (
      length >= 2 &&
      length <= 15 &&
      Math.abs(dx) / length >= 0.4 &&
      Math.abs(dx) / length <= 0.9 &&
      Math.abs(dy) / length >= 0.4 &&
      Math.abs(dy) / length <= 0.9
    )
  })
  let remainingWork = MAX_DISCOVERY_WORK
  const exhausted = Symbol('dimension-discovery-budget')
  const spend = (count = 1) => {
    remainingWork -= count
    if (remainingWork < 0) throw exhausted
  }
  // Without a caption context this preserves the existing strict legacy proof;
  // compact text slots are not reinterpreted as original PDF label identities.
  // Charge comparisons actually performed by the shared verifier. Unmarked wall
  // strokes must not consume the cost of a branch search that never runs.
  const verify = createPdfNativePageDimensionChainVerifier(work, source, undefined, spend)
  try {
    for (const label of labels) {
      spend()
      const rotation = (((label.rotation ?? 0) % 180) + 180) % 180
      const axis =
        Math.min(rotation, 180 - rotation) <= 1e-6
          ? 'width'
          : Math.abs(rotation - 90) <= 1e-6
            ? 'depth'
            : null
      const valueMm = nativeDimensionMillimetres(label.name)
      if (!axis || !label.pagePoint || valueMm === undefined) {
        unresolved.push({ labelId: label.id, reason: 'unsupported-dimension-orientation' })
        continue
      }
      const evidence = verify(
        [
          {
            index: label.nativeIndex as number,
            text: label.name,
            ...label.pagePoint,
            // Cardinal orientation only; preserve the original unrounded angle in native input.
            rotation: axis === 'width' ? 0 : 90,
          },
        ],
        valueMm,
        axis,
      )
      if (evidence.status !== 'candidate') {
        unresolved.push({ labelId: label.id, reason: evidence.reason })
        continue
      }
      const operation = evidence.lineOperations[0]
      const paths = operation === undefined ? [] : (pathsByOperation.get(operation) ?? [])
      const railPath = paths[0]
      const rails = operation === undefined ? [] : (segmentsByOperation.get(operation) ?? [])
      const rail = rails[0]
      if (
        evidence.lineOperations.length !== 1 ||
        paths.length !== 1 ||
        !railPath ||
        railPath.closed ||
        railPath.paint !== 'stroke' ||
        railPath.points.length !== 2 ||
        rails.length !== 1 ||
        !rail
      ) {
        unresolved.push({ labelId: label.id, reason: 'non-unique-dimension-rail' })
        continue
      }
      const across = (point: { x: number; y: number }) => (axis === 'width' ? point.y : point.x)
      const ticksAt = (endpoint: { x: number; y: number }) =>
        tickSources.filter((segment) => {
          spend()
          if (segment.operationIndex === operation) return false
          return (
            pdfPointDistance(work, endpoint, {
              x: (segment.start.x + segment.end.x) / 2,
              y: (segment.start.y + segment.end.y) / 2,
            }) <= 0.12 &&
            (across(segment.start) - across(endpoint)) * (across(segment.end) - across(endpoint)) <
              0
          )
        })
      const first = ticksAt(rail.start),
        last = ticksAt(rail.end)
      const ticks =
        first.length === 1 && last.length === 1 && first[0] !== last[0]
          ? ([first[0], last[0]] as NativePageSegment[])
          : []
      candidates.push({ labelId: label.id, valueMm, axis, rail, spanEnds: evidence.ends, ticks })
    }
    const railClaims = new Map<string, number>()
    const railKey = (rail: NativePageSegment) =>
      `${rail.operationIndex}:${rail.subpathIndex}:${rail.segmentIndex}`
    for (const candidate of candidates) {
      spend()
      const key = railKey(candidate.rail)
      railClaims.set(key, (railClaims.get(key) ?? 0) + 1)
    }
    for (let index = candidates.length - 1; index >= 0; index--) {
      spend()
      const candidate = candidates[index]
      if (candidate && (railClaims.get(railKey(candidate.rail)) ?? 0) > 1) {
        unresolved.push({ labelId: candidate.labelId, reason: 'competing-dimension-labels' })
        candidates.splice(index, 1)
      }
    }
    return result(null)
  } catch (error) {
    if (error === exhausted) return result('dimension-discovery-budget')
    throw error
  }
}
