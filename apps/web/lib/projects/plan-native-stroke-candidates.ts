import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import { boundedNativeStrokeFaces, type NativeIntersectionProof } from './plan-native-stroke-faces'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

const pointKey = (point: PagePoint) => `${point.x}:${point.y}`
const cross = (a: PagePoint, b: PagePoint, p: PagePoint) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
function touches(a: NativePageSegment, b: NativePageSegment) {
  if (
    Math.max(a.start.x, a.end.x) < Math.min(b.start.x, b.end.x) ||
    Math.max(b.start.x, b.end.x) < Math.min(a.start.x, a.end.x) ||
    Math.max(a.start.y, a.end.y) < Math.min(b.start.y, b.end.y) ||
    Math.max(b.start.y, b.end.y) < Math.min(a.start.y, a.end.y)
  )
    return false
  const first = cross(a.start, a.end, b.start),
    second = cross(a.start, a.end, b.end),
    third = cross(b.start, b.end, a.start),
    fourth = cross(b.start, b.end, a.end)
  return (
    (first === 0 || second === 0 || Math.sign(first) !== Math.sign(second)) &&
    (third === 0 || fourth === 0 || Math.sign(third) !== Math.sign(fourth))
  )
}

type StrokeCandidateInput = {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}

function strokeCandidates(input: StrokeCandidateInput, boundedFaces: boolean) {
  // Reuse source-frame and extraction-completeness checks, not fill classification.
  const inventory = nativeFillCandidates(input)
  const { work, native } = input
  const scale = native.pageNormalizedScale
  const candidates: {
    id: string
    polygon: PagePoint[]
    rasterPolygon: PagePoint[]
    /** Unordered source evidence, not edge-by-edge correspondence after canonicalization. */
    sourceRefs: NativePageSegment[]
    /** Ordered subedges supported by original segments, including exact bounded cuts. */
    boundedEdges?: { start: PagePoint; end: PagePoint; sourceRefs: NativePageSegment[] }[]
    pixelArea: number
  }[] = []
  const rejected: { firstSegment: number; reason: string }[] = []
  let intersections: NativeIntersectionProof[] = []
  const result = (refusalReason: string | null, blockedSourceRefs?: NativePageSegment[]) => ({
    status: 'draft' as const,
    semanticStatus: 'unclassified' as const,
    basis: boundedFaces
      ? ('native-stroke-bounded-face' as const)
      : ('native-stroke-endpoint-cycle' as const),
    source: native.source,
    originalPdfSha256: native.originalPdfSha256,
    candidates: refusalReason ? [] : candidates,
    rejected,
    truncated: refusalReason !== null,
    refusalReason,
    ...(blockedSourceRefs?.length ? { blockedSourceRefs } : {}),
    ...(boundedFaces ? { intersections: refusalReason ? [] : intersections } : {}),
  })
  if (
    inventory.refusalReason === 'incomplete-native-layer' ||
    !scale ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0)
  )
    return result('incomplete-native-layer')
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
    return result('invalid-native-provenance')
  const omitted = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    omitted.some(
      ({ bounds }) =>
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return result('invalid-omitted-bounds')
  const segments = nativePageSegments(work)
  if (boundedFaces) {
    const graph = boundedNativeStrokeFaces(
      segments,
      inventory.minimumPixelArea / (scale.x * scale.y),
    )
    if (graph.refusalReason) return result(graph.refusalReason, graph.blockedSourceRefs)
    intersections = graph.intersections
    for (const [index, face] of graph.faces.entries()) {
      const polygon = face.polygon.map((point) => ({ ...point }))
      const bounds = {
        left: Math.min(...polygon.map((point) => point.x)),
        right: Math.max(...polygon.map((point) => point.x)),
        top: Math.min(...polygon.map((point) => point.y)),
        bottom: Math.max(...polygon.map((point) => point.y)),
      }
      const reject = (reason: string) => rejected.push({ firstSegment: index, reason })
      if (bounds.left <= 0 || bounds.top <= 0 || bounds.right >= 1000 || bounds.bottom >= 1000) {
        reject('page-frame-face')
        continue
      }
      const area =
        polygon.reduce((sum, point, pointIndex) => {
          const next = polygon[(pointIndex + 1) % polygon.length]
          return next ? sum + point.x * next.y - next.x * point.y : sum
        }, 0) / 2
      const pixelArea = area * scale.x * scale.y
      if (pixelArea < inventory.minimumPixelArea) {
        reject('small-annotation-face')
        continue
      }
      if (
        omitted.some(
          ({ bounds: box }) =>
            box.left <= bounds.right + 3 / scale.x &&
            box.right >= bounds.left - 3 / scale.x &&
            box.top <= bounds.bottom + 3 / scale.y &&
            box.bottom >= bounds.top - 3 / scale.y,
        )
      ) {
        reject('near-omitted-geometry')
        continue
      }
      if (candidates.length === 50) return result('candidate-limit')
      const beginning = polygon.reduce((best, point, pointIndex) => {
        const current = polygon[best]
        return !current || point.x < current.x || (point.x === current.x && point.y < current.y)
          ? pointIndex
          : best
      }, 0)
      polygon.push(...polygon.splice(0, beginning))
      const evidence = [...face.edges]
      evidence.push(...evidence.splice(0, beginning))
      const uniqueRefs = new Map(
        evidence
          .flatMap((edge) => edge.sourceRefs)
          .map((ref) => [`${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`, ref]),
      )
      candidates.push({
        id: `native-stroke-face-${index}`,
        polygon,
        rasterPolygon: polygon.map((point) => ({ x: point.x * scale.x, y: point.y * scale.y })),
        pixelArea,
        sourceRefs: [...uniqueRefs.values()],
        boundedEdges: evidence.map((edge, edgeIndex) => ({
          start: polygon[edgeIndex] as PagePoint,
          end: polygon[(edgeIndex + 1) % polygon.length] as PagePoint,
          sourceRefs: edge.sourceRefs,
        })),
      })
    }
    return result(null)
  }
  const adjacency = new Map<string, number[]>()
  for (const [index, segment] of segments.entries()) {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point)
      const edges = adjacency.get(key)
      if (edges) edges.push(index)
      else adjacency.set(key, [index])
    }
  }
  const visited = new Set<number>()
  let checks = 200_000
  for (let seed = 0; seed < segments.length; seed++) {
    if (visited.has(seed)) continue
    const component = new Set<number>(),
      pending = [seed]
    while (pending.length) {
      const index = pending.pop()
      if (index === undefined || component.has(index)) continue
      component.add(index)
      visited.add(index)
      const segment = segments[index]
      if (!segment) return result('incomplete-segment-inventory')
      for (const point of [segment.start, segment.end])
        for (const neighbour of adjacency.get(pointKey(point)) ?? []) {
          if (--checks < 0) return result('graph-search-budget')
          if (!component.has(neighbour)) pending.push(neighbour)
        }
    }
    const reject = (reason: string) => rejected.push({ firstSegment: seed, reason })
    if (component.size < 3 || component.size > 100) {
      reject('unsupported-component-size')
      continue
    }
    if (
      [...component].some((index) => {
        const segment = segments[index]
        return (
          !segment ||
          [segment.start, segment.end].some((point) => adjacency.get(pointKey(point))?.length !== 2)
        )
      })
    ) {
      reject('open-or-branched-component')
      continue
    }
    const first = segments[seed]
    if (!first) return result('incomplete-segment-inventory')
    const startKey = pointKey(first.start)
    const polygon: PagePoint[] = []
    const walked = new Set<number>()
    let point = first.start
    while (walked.size < component.size) {
      polygon.push({ ...point })
      const index = adjacency.get(pointKey(point))?.find((edge) => !walked.has(edge))
      const segment = index === undefined ? undefined : segments[index]
      if (index === undefined || !segment) break
      walked.add(index)
      point = pointKey(segment.start) === pointKey(point) ? segment.end : segment.start
    }
    if (
      pointKey(point) !== startKey ||
      walked.size !== component.size ||
      !pdfPolygonIsValid(polygon)
    ) {
      reject('non-simple-or-open-cycle')
      continue
    }
    const bounds = {
      left: Math.min(...polygon.map((p) => p.x)),
      right: Math.max(...polygon.map((p) => p.x)),
      top: Math.min(...polygon.map((p) => p.y)),
      bottom: Math.max(...polygon.map((p) => p.y)),
    }
    if (bounds.left <= 0 || bounds.top <= 0 || bounds.right >= 1000 || bounds.bottom >= 1000) {
      reject('page-frame-cycle')
      continue
    }
    const twiceArea = polygon.reduce((sum, p, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + p.x * next.y - next.x * p.y : sum
    }, 0)
    const pixelArea = Math.abs(twiceArea / 2) * scale.x * scale.y
    if (pixelArea < inventory.minimumPixelArea) {
      reject('small-annotation-cycle')
      continue
    }
    // Conservative: an omitted curve/clip anywhere in the bounding box blocks this cycle.
    if (
      omitted.some(
        ({ bounds: area }) =>
          area.left <= bounds.right + 3 / scale.x &&
          area.right >= bounds.left - 3 / scale.x &&
          area.top <= bounds.bottom + 3 / scale.y &&
          area.bottom >= bounds.top - 3 / scale.y,
      )
    ) {
      reject('near-omitted-geometry')
      continue
    }
    let intersects = false
    for (const index of component) {
      const a = segments[index]
      if (!a) return result('incomplete-segment-inventory')
      for (const [otherIndex, b] of segments.entries()) {
        if (component.has(otherIndex)) continue
        if (--checks < 0) return result('intersection-search-budget')
        if (touches(a, b)) intersects = true
      }
    }
    if (intersects) {
      reject('crossing-external-stroke')
      continue
    }
    if (candidates.length === 50) return result('candidate-limit')
    if (twiceArea < 0) polygon.reverse()
    const beginning = polygon.reduce(
      (best, p, index) =>
        p.x < (polygon[best]?.x ?? Infinity) ||
        (p.x === polygon[best]?.x && p.y < (polygon[best]?.y ?? Infinity))
          ? index
          : best,
      0,
    )
    polygon.push(...polygon.splice(0, beginning))
    candidates.push({
      id: `native-stroke-cycle-${seed}`,
      polygon,
      rasterPolygon: polygon.map((p) => ({ x: p.x * scale.x, y: p.y * scale.y })),
      sourceRefs: [...component].map((index) => segments[index] as NativePageSegment),
      pixelArea,
    })
  }
  return result(null)
}

/** Exact endpoint cycles in native strokes; no wall/floor classification or gap closing. */
export function nativeStrokeCycleCandidates(input: StrokeCandidateInput) {
  return strokeCandidates(input, false)
}

/** Additional bounded-axis-intersection candidates; never promotes them to confirmed floors. */
export function nativeStrokeFaceCandidates(input: StrokeCandidateInput) {
  return strokeCandidates(input, true)
}
