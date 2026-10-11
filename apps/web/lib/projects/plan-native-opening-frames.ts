import type { NativeTextAnchors } from './plan-document'
import {
  exactNativeOrientation,
  exactNativePointKey,
  exactNativePolygonsOverlap,
} from './plan-native-exact-intersections'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { Bounds, PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeOpeningFrame = {
  id: string
  frame: PdfVectorPath
  repaintAliases: PdfVectorPath[]
  longEdges: NativePageSegment[]
  jambs: { frameEdge: NativePageSegment; sourceEdges: NativePageSegment[] }[]
  unresolvedInk: { kind: 'curve' | 'clip'; operationIndex: number; bounds: Bounds }[]
  openingKind: null
  semanticStatus: 'unclassified'
  physicalPassageAccepted: false
  closesFloorBoundary: false
}

const MAX_CANDIDATES = 100
const MAX_COMPARISONS = 200_000
const MAX_ASPECT_RATIO = 0.4
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y

function polygonPoints(path: PdfVectorPath): PagePoint[] {
  const first = path.points[0]
  const last = path.points.at(-1)
  return first && last && samePoint(first, last) ? path.points.slice(0, -1) : path.points
}

// Prove the shape in the source-decimal domain, after accounting for page aspect.
// Floating rotations, snapping and angle tolerances would change the source evidence.
export function exactNativeOpeningFrameShape(
  points: PagePoint[],
  scale?: { x: number; y: number },
): boolean {
  if (points.length !== 4 || points.some((point) => exactNativePointKey(point) === null))
    return false
  if (
    scale &&
    (!Number.isFinite(scale.x) || !Number.isFinite(scale.y) || scale.x <= 0 || scale.y <= 0)
  )
    return false
  const decimals = [
    ...points.flatMap((point) => [point.x, point.y]),
    ...(scale ? [scale.x, scale.y] : []),
  ].map((value) => {
    const [mantissa = '', exponent = '0'] = value.toString().split('e')
    const [whole = '', fraction = ''] = mantissa.split('.')
    const places = fraction.length - Number(exponent)
    if (Math.abs(places) > 18) return null
    return {
      value: BigInt(whole + fraction) * (places < 0 ? 10n ** BigInt(-places) : 1n),
      places: Math.max(0, places),
    }
  })
  if (decimals.some((value) => value === null)) return false
  const places = Math.max(...decimals.map((value) => value?.places ?? 0))
  const integers = decimals.map((value) =>
    value ? value.value * 10n ** BigInt(places - value.places) : 0n,
  )
  const [ax, ay, bx, by, cx, cy, dx, dy] = integers as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ]
  if (ax + cx !== bx + dx || ay + cy !== by + dy) return false
  const first = { x: bx - ax, y: by - ay }
  const second = { x: cx - bx, y: cy - by }
  if (first.x * second.y - first.y * second.x === 0n) return false
  // A packet consumer without the raster scale can verify topology, not physical right angles.
  if (!scale) return true
  const scaleX = integers[8] as bigint
  const scaleY = integers[9] as bigint
  return (
    (first.x !== 0n || first.y !== 0n) &&
    (second.x !== 0n || second.y !== 0n) &&
    first.x * second.x * scaleX ** 2n + first.y * second.y * scaleY ** 2n === 0n
  )
}

function completeJambCoverage(jamb: NativePageSegment, sources: NativePageSegment[]): boolean {
  const axis = jamb.start.x === jamb.end.x ? 'y' : 'x'
  const from = Math.min(jamb.start[axis], jamb.end[axis])
  const to = Math.max(jamb.start[axis], jamb.end[axis])
  const intervals = sources
    .map((edge) => ({
      from: Math.max(from, Math.min(edge.start[axis], edge.end[axis])),
      to: Math.min(to, Math.max(edge.start[axis], edge.end[axis])),
    }))
    .filter((interval) => interval.from < interval.to)
    .sort((a, b) => a.from - b.from)
  let covered = from
  for (const interval of intervals) {
    if (interval.from > covered) return false
    covered = Math.max(covered, interval.to)
    if (covered === to) return true
  }
  return false
}

function sourceEdges(path: PdfVectorPath): NativePageSegment[] {
  const points = path.points
  const first = points[0],
    last = points.at(-1)
  const count = first && last && samePoint(first, last) ? points.length - 1 : points.length
  return points.slice(0, count).map((start, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start,
    end: points[(segmentIndex + 1) % count] as PagePoint,
  }))
}

/** Painted frame boundaries only. Neither jamb contact nor a rectangle proves a free floor. */
export function nativeOpeningFrameCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { native, work } = input
  const frameCheck = nativeFillCandidates(input)
  const scale = native.pageNormalizedScale
  const candidates: NativeOpeningFrame[] = []
  const rejected: { operationIndex: number; subpathIndex: number; reason: string }[] = []
  let rejectedCount = 0
  const reject = (path: PdfVectorPath, reason: string) => {
    rejectedCount++
    if (rejected.length < MAX_CANDIDATES)
      rejected.push({
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        reason,
      })
  }
  const finish = (reason: string | null) => ({
    status: reason ? ('unresolved' as const) : ('draft' as const),
    basis: 'native-painted-frame-and-jamb-contacts' as const,
    coverageScope: 'exact-physical-rectangular-source-frames-only' as const,
    source: native.source,
    originalPdfSha256: native.originalPdfSha256,
    candidates: reason ? [] : structuredClone(candidates),
    rejected,
    rejectedCount,
    diagnosticsTruncated: rejectedCount > rejected.length,
    refusalReason: reason,
    completeOpeningInventory: false as const,
    closesFloorBoundary: false as const,
  })
  if (frameCheck.refusalReason === 'incomplete-native-layer' || !scale)
    return finish('incomplete-native-layer')
  const refs = new Set<string>()
  const counts = new Map<number, number>()
  for (const path of work.paths) {
    const ref = `${path.operationIndex}:${path.subpathIndex}`
    if (
      refs.has(ref) ||
      ![path.operationIndex, path.subpathIndex].every(
        (number) => Number.isSafeInteger(number) && number >= 0,
      )
    )
      return finish('invalid-native-provenance')
    if (typeof path.closed !== 'boolean' || !['stroke', 'fill', 'fill-stroke'].includes(path.paint))
      return finish('invalid-native-provenance')
    if (path.points.some((point) => exactNativePointKey(point) === null))
      return finish('unsupported-source-coordinate-precision')
    refs.add(ref)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  }
  const omitted = [
    ...(work.skippedCurveBounds ?? []).map((item) => ({ ...item, kind: 'curve' as const })),
    ...(work.clippedPathBounds ?? []).map((item) => ({ ...item, kind: 'clip' as const })),
  ]
  if (
    ![work.skippedCurves, work.clippedPaths].every(
      (number) => Number.isSafeInteger(number) && number >= 0,
    ) ||
    (work.skippedCurveBounds?.length ?? 0) !== work.skippedCurves ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths
  )
    return finish('invalid-omission-provenance')
  if (
    omitted.length > 6000 ||
    omitted.some(
      ({ operationIndex, bounds }) =>
        !Number.isSafeInteger(operationIndex) ||
        operationIndex < 0 ||
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return finish('invalid-omission-provenance')
  const omittedOperations = new Set(omitted.map((item) => item.operationIndex))
  const supported = (path: PdfVectorPath) =>
    path.paint === 'stroke' &&
    path.closed &&
    counts.get(path.operationIndex) === 1 &&
    !omittedOperations.has(path.operationIndex)
  // These paths provide painted edge provenance, not wall or interior ownership.
  const contacts = work.paths
    .filter((path) => {
      const first = path.points[0],
        last = path.points.at(-1)
      const vertices =
        first && last && samePoint(first, last) ? path.points.length - 1 : path.points.length
      return supported(path) && vertices >= 6 && vertices <= 100
    })
    .flatMap(sourceEdges)
    .filter((edge) => !samePoint(edge.start, edge.end))
  const rectangles = new Map<
    string,
    { path: PdfVectorPath; aliases: PdfVectorPath[]; bounds: Bounds; shortEdgeParity: number }
  >()
  for (const path of work.paths) {
    if (!supported(path)) continue
    const points = polygonPoints(path)
    if (!exactNativeOpeningFrameShape(points, scale)) continue
    const edges = sourceEdges(path)
    const lengths = edges
      .slice(0, 2)
      .map((edge) =>
        Math.hypot((edge.end.x - edge.start.x) * scale.x, (edge.end.y - edge.start.y) * scale.y),
      )
    const width = lengths[0] as number
    const height = lengths[1] as number
    if (
      Math.min(width, height) <= 0 ||
      Math.max(width, height) < 5 ||
      Math.min(width, height) / Math.max(width, height) > MAX_ASPECT_RATIO
    )
      continue
    const bounds = {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    }
    const key = points
      .map((point) => exactNativePointKey(point))
      .sort()
      .join('|')
    const previous = rectangles.get(key)
    if (previous) previous.aliases.push(path)
    else rectangles.set(key, { path, aliases: [], bounds, shortEdgeParity: width < height ? 0 : 1 })
  }
  let comparisons = 0
  const spend = () => ++comparisons <= MAX_COMPARISONS
  const pending: { candidate: NativeOpeningFrame; bounds: Bounds }[] = []
  for (const { path, aliases, bounds, shortEdgeParity } of rectangles.values()) {
    const edges = sourceEdges(path)
    const jambEdges = edges.filter((_, index) => index % 2 === shortEdgeParity)
    const jambs: NativeOpeningFrame['jambs'] = []
    for (const frameEdge of jambEdges) {
      const sourceMatches: NativePageSegment[] = []
      for (const edge of contacts) {
        if (!spend()) return finish('frame-search-budget')
        const axis = frameEdge.start.x === frameEdge.end.x ? 'y' : 'x'
        if (
          Math.max(
            Math.min(frameEdge.start[axis], frameEdge.end[axis]),
            Math.min(edge.start[axis], edge.end[axis]),
          ) <
            Math.min(
              Math.max(frameEdge.start[axis], frameEdge.end[axis]),
              Math.max(edge.start[axis], edge.end[axis]),
            ) &&
          exactNativeOrientation(frameEdge.start, frameEdge.end, edge.start) === 0 &&
          exactNativeOrientation(frameEdge.start, frameEdge.end, edge.end) === 0
        )
          sourceMatches.push(edge)
      }
      jambs.push({ frameEdge, sourceEdges: sourceMatches })
    }
    if (jambs.some((jamb) => !completeJambCoverage(jamb.frameEdge, jamb.sourceEdges))) {
      reject(path, 'no-two-complete-source-jambs')
      continue
    }
    const unresolvedInk: NativeOpeningFrame['unresolvedInk'] = []
    for (const item of omitted) {
      if (!spend()) return finish('frame-search-budget')
      if (
        item.bounds.right >= bounds.left &&
        item.bounds.left <= bounds.right &&
        item.bounds.bottom >= bounds.top &&
        item.bounds.top <= bounds.bottom
      )
        unresolvedInk.push(item)
    }
    if (pending.length === MAX_CANDIDATES) return finish('frame-candidate-limit')
    pending.push({
      bounds,
      candidate: {
        id: `native-opening-frame-${path.operationIndex}:${path.subpathIndex}`,
        frame: path,
        repaintAliases: aliases,
        longEdges: edges.filter((_, index) => index % 2 !== shortEdgeParity),
        jambs,
        unresolvedInk,
        openingKind: null,
        semanticStatus: 'unclassified',
        physicalPassageAccepted: false,
        closesFloorBoundary: false,
      },
    })
  }
  const competing = new Set<NativeOpeningFrame>()
  for (let index = 0; index < pending.length; index++) {
    const first = pending[index]
    if (!first) continue
    for (const second of pending.slice(index + 1)) {
      if (!spend()) return finish('frame-search-budget')
      if (
        Math.min(first.bounds.right, second.bounds.right) >
          Math.max(first.bounds.left, second.bounds.left) &&
        Math.min(first.bounds.bottom, second.bounds.bottom) >
          Math.max(first.bounds.top, second.bounds.top) &&
        exactNativePolygonsOverlap(
          polygonPoints(first.candidate.frame),
          polygonPoints(second.candidate.frame),
        ) !== false
      ) {
        competing.add(first.candidate)
        competing.add(second.candidate)
      }
    }
  }
  for (const { candidate } of pending) {
    if (competing.has(candidate)) reject(candidate.frame, 'competing-painted-frames')
    else candidates.push(candidate)
  }
  return finish(null)
}
