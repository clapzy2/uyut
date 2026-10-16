import type { NativeTextAnchors } from './plan-document'
import { exactNativePointKey, exactNativeSegmentsTouch } from './plan-native-exact-intersections'
import type { Bounds, PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

type ClosedRunEvidence = {
  id: string
  edges: NativePageSegment[]
  sourceKind: 'closed-path' | 'literal-closed-run'
  remainingSegments: NativePageSegment[]
}

export type NativeClosedStrokeRun = ClosedRunEvidence & {
  polygon: PagePoint[]
  /** Exact repaint geometry; ordered edge/source evidence stays separate. */
  repaintAliases?: ClosedRunEvidence[]
}

export type NativeConflictedClosedStrokeRun = NativeClosedStrokeRun & {
  boundaryOmissions: { kind: 'curve' | 'clip'; operationIndex: number; bounds: Bounds }[]
}

const MAX_WORK = 200_000
const MAX_CANDIDATES = 100
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y

function sourceSegments(path: PdfVectorPath): NativePageSegment[] {
  const first = path.points[0]
  const last = path.points.at(-1)
  const explicitReturn = first && last && samePoint(first, last)
  const count = path.points.length - 1 + (path.closed && !explicitReturn ? 1 : 0)
  return Array.from({ length: count }, (_, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start: path.points[segmentIndex] as PagePoint,
    end: path.points[(segmentIndex + 1) % path.points.length] as PagePoint,
  }))
}

/** Identity comparison only: never rotates or reverses emitted source geometry. */
function geometryKey(polygon: PagePoint[]): string {
  const keys = polygon.map((point) => `${point.x}:${point.y}`)
  let minimum = 0
  for (let index = 1; index < keys.length; index++)
    if ((keys[index] as string) < (keys[minimum] as string)) minimum = index
  const forward = keys.map((_, index) => keys[(minimum + index) % keys.length]).join(';')
  const reverse = keys
    .map((_, index) => keys[(minimum - index + keys.length) % keys.length])
    .join(';')
  return forward < reverse ? forward : reverse
}

function edgeTouchesBounds(edge: NativePageSegment, bounds: Bounds): boolean {
  if (
    Math.max(edge.start.x, edge.end.x) < bounds.left ||
    Math.min(edge.start.x, edge.end.x) > bounds.right ||
    Math.max(edge.start.y, edge.end.y) < bounds.top ||
    Math.min(edge.start.y, edge.end.y) > bounds.bottom
  )
    return false
  const inside = (point: PagePoint) =>
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  if (inside(edge.start) || inside(edge.end)) return true
  // Diagnostic bounds may extend beyond the page. Intersections with an in-page
  // source segment are unchanged by clipping this guard rectangle to the page.
  const corners = [
    { x: Math.max(0, bounds.left), y: Math.max(0, bounds.top) },
    { x: Math.min(1000, bounds.right), y: Math.max(0, bounds.top) },
    { x: Math.min(1000, bounds.right), y: Math.min(1000, bounds.bottom) },
    { x: Math.max(0, bounds.left), y: Math.min(1000, bounds.bottom) },
  ]
  return corners.some(
    (start, index) =>
      exactNativeSegmentsTouch(edge, { start, end: corners[(index + 1) % 4] as PagePoint }) !==
      false,
  )
}

/** Literal source stroke loops, not room, wall or floor classifications. */
export function nativeClosedStrokeRuns(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  /** Neutral source-shape filter, never a floor or wall classification. */
  minimumEdges?: number
}) {
  const { native, work } = input
  const minimumEdges = input.minimumEdges === undefined ? 3 : input.minimumEdges
  const candidates: NativeClosedStrokeRun[] = []
  const conflictedCandidates: NativeConflictedClosedStrokeRun[] = []
  const rejected: { id: string; reason: string }[] = []
  let rejectedCount = 0
  let checks = 0
  let evidenceCount = 0
  const spend = (count = 1) => {
    checks += count
    return checks <= MAX_WORK
  }
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    candidates: refusalReason ? [] : structuredClone(candidates),
    conflictedCandidates: refusalReason ? [] : structuredClone(conflictedCandidates),
    source: { ...native.source },
    originalPdfSha256: native.originalPdfSha256,
    rejected,
    rejectedCount,
    diagnosticsTruncated: rejectedCount > rejected.length,
    readOnly: true as const,
    closesFloorBoundary: false as const,
  })
  const reject = (id: string, reason: string) => {
    rejectedCount++
    if (rejected.length < MAX_CANDIDATES) rejected.push({ id, reason })
  }
  if (!Number.isSafeInteger(minimumEdges) || minimumEdges < 3 || minimumEdges > 100)
    return finish('invalid-closed-run-size-filter')
  try {
    bindObservedRegionLabels({
      regionSource: native.source,
      labelSource: input.lineworkSource,
      regions: [],
      labels: [],
    })
  } catch {
    return finish('source-frame-unavailable')
  }
  const scale = native.pageNormalizedScale
  if (
    !/^[a-f0-9]{64}$/.test(native.originalPdfSha256 ?? '') ||
    !scale ||
    ![scale.x, scale.y].every((value) => Number.isFinite(value) && value > 0) ||
    scale.x * 1000 > native.source.width + 0.001 ||
    scale.y * 1000 > native.source.height + 0.001 ||
    scale.x * 1000 < native.source.width * 0.995 ||
    scale.y * 1000 < native.source.height * 0.995 ||
    work.coordinateSystem !== 'page-0-1000' ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0)
  )
    return finish('source-frame-unavailable')
  if (
    ![work.skippedCurves, work.clippedPaths, work.unsupportedPaths, work.unsupportedContexts].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    typeof work.truncated !== 'boolean' ||
    work.truncated ||
    work.unsupportedPaths ||
    work.unsupportedContexts ||
    work.curvePathsTruncated ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated
  )
    return finish('incomplete-native-layer')
  const curves = work.curvePaths ?? []
  if (
    !Array.isArray(work.paths) ||
    !Array.isArray(curves) ||
    work.paths.length + curves.length > 5000 ||
    work.paths.some((path) => !path || !Array.isArray(path.points) || path.points.length < 2) ||
    curves.some((path) => !path || !Array.isArray(path.segments)) ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) +
      curves.reduce((sum, path) => sum + path.segments.length * 3 + 1, 0) >
      20_000
  )
    return finish('native-path-limit')
  if (
    (work.skippedCurveBounds !== undefined && !Array.isArray(work.skippedCurveBounds)) ||
    (work.clippedPathBounds !== undefined && !Array.isArray(work.clippedPathBounds))
  )
    return finish('invalid-omission-provenance')
  const omitted = [
    ...(work.skippedCurveBounds ?? []).map((item) => ({ ...item, kind: 'curve' as const })),
    ...(work.clippedPathBounds ?? []).map((item) => ({ ...item, kind: 'clip' as const })),
  ]
  if (
    (work.skippedCurveBounds?.length ?? 0) !== work.skippedCurves ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths ||
    curves.length > work.skippedCurves ||
    omitted.length > 6000 ||
    omitted.some(
      (item) =>
        !item ||
        !Number.isSafeInteger(item.operationIndex) ||
        item.operationIndex < 0 ||
        !item.bounds ||
        ![item.bounds.left, item.bounds.right, item.bounds.top, item.bounds.bottom].every(
          Number.isFinite,
        ) ||
        item.bounds.left > item.bounds.right ||
        item.bounds.top > item.bounds.bottom,
    )
  )
    return finish('invalid-omission-provenance')
  const omittedOperations = new Set(omitted.map(({ operationIndex }) => operationIndex))
  const sourceRefs = new Set<string>()
  for (const path of [...work.paths, ...curves]) {
    const key = `${path.operationIndex}:${path.subpathIndex}`
    if (
      sourceRefs.has(key) ||
      ![path.operationIndex, path.subpathIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      typeof path.closed !== 'boolean' ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint)
    )
      return finish('invalid-native-provenance')
    sourceRefs.add(key)
  }
  for (const path of work.paths) {
    for (const point of path.points) {
      if (!spend()) return finish('closed-run-search-budget')
      if (!point || exactNativePointKey(point) === null)
        return finish('unsupported-source-coordinate-precision')
    }
  }
  if (curves.some((curve) => !omittedOperations.has(curve.operationIndex)))
    return finish('invalid-omission-provenance')
  const knownGeometry = new Map<string, NativeClosedStrokeRun>()
  for (const path of work.paths) {
    if (path.paint !== 'stroke') continue
    const sourceId = `native-closed-run-${path.operationIndex}:${path.subpathIndex}`
    if (omittedOperations.has(path.operationIndex)) {
      reject(sourceId, 'omitted-operation-sibling')
      continue
    }
    const segments = sourceSegments(path)
    const add = (edges: NativePageSegment[], sourceKind: ClosedRunEvidence['sourceKind']) => {
      const id = `${sourceId}:${edges[0]?.segmentIndex}-${edges.at(-1)?.segmentIndex}`
      const polygon = edges.map(({ start }) => start)
      // Reserve both the existing simple-polygon check and the exact-decimal
      // non-adjacent edge check; neither gets an unbounded nested loop.
      if (!spend(2 * polygon.length ** 2)) return 'closed-run-search-budget'
      if (edges.length < minimumEdges) return null
      if (edges.length > 100 || !pdfPolygonIsValid(polygon)) {
        reject(id, 'non-simple-closed-run')
        return null
      }
      const boundaryOmissions = new Set<number>()
      for (let index = 0; index < edges.length; index++) {
        const edge = edges[index] as NativePageSegment
        if (samePoint(edge.start, edge.end)) {
          reject(id, 'zero-source-edge')
          return null
        }
        for (let other = index + 2; other < edges.length; other++) {
          if (index === 0 && other === edges.length - 1) continue
          if (exactNativeSegmentsTouch(edge, edges[other] as NativePageSegment) !== false) {
            reject(id, 'non-simple-closed-run')
            return null
          }
        }
        for (const [omissionIndex, item] of omitted.entries()) {
          if (!spend()) return 'closed-run-search-budget'
          if (edgeTouchesBounds(edge, item.bounds)) {
            boundaryOmissions.add(omissionIndex)
            if (boundaryOmissions.size > MAX_CANDIDATES) return 'boundary-omission-limit'
          }
        }
      }
      if (++evidenceCount > MAX_CANDIDATES) return 'candidate-limit'
      if (!spend(segments.length)) return 'closed-run-search-budget'
      const selected = new Set(edges.map(({ segmentIndex }) => segmentIndex))
      const evidence: ClosedRunEvidence = {
        id,
        edges,
        sourceKind,
        remainingSegments: segments.filter(({ segmentIndex }) => !selected.has(segmentIndex)),
      }
      const key = geometryKey(polygon)
      const previous = knownGeometry.get(key)
      if (boundaryOmissions.size) reject(id, 'omitted-ink-touches-boundary')
      if (previous) {
        previous.repaintAliases ??= []
        previous.repaintAliases.push(evidence)
      } else if (boundaryOmissions.size) {
        const candidate = {
          ...evidence,
          polygon,
          boundaryOmissions: [...boundaryOmissions].map(
            (index) =>
              omitted[index] as NativeConflictedClosedStrokeRun['boundaryOmissions'][number],
          ),
        }
        knownGeometry.set(key, candidate)
        conflictedCandidates.push(candidate)
      } else {
        const candidate = { ...evidence, polygon }
        knownGeometry.set(key, candidate)
        candidates.push(candidate)
      }
      return null
    }
    const explicitReturn = samePoint(path.points[0] as PagePoint, path.points.at(-1) as PagePoint)
    const wholeId =
      path.closed && segments.length >= minimumEdges && segments.length <= 100
        ? `${sourceId}:0-${segments.length - 1}`
        : null
    if (wholeId) {
      const reason = add(segments, 'closed-path')
      if (reason) return finish(reason)
    }
    const previousVertices = new Map<string, number[]>()
    for (const [end, point] of path.points.entries()) {
      const key = `${point.x}:${point.y}`
      const starts = previousVertices.get(key) ?? []
      for (const start of starts) {
        if (!spend()) return finish('closed-run-search-budget')
        const length = end - start
        if (length < minimumEdges || length > 100) continue
        // A source closed path with an explicit return has already supplied this
        // same sequence. Do not duplicate its evidence as a synthetic second loop.
        if (wholeId && explicitReturn && start === 0 && end === path.points.length - 1) continue
        const reason = add(segments.slice(start, end), 'literal-closed-run')
        if (reason) return finish(reason)
      }
      starts.push(end)
      previousVertices.set(key, starts)
    }
  }
  return finish(null)
}
