import {
  exactNativeCrossing,
  exactNativeOrientation,
  exactNativePointKey,
} from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import type { PagePoint } from './plan-pdf-linework'
import { type NativePageSegment, nativeEdgeCrossing } from './plan-pdf-opening-endpoint'
import { pdfPointInside, pdfPolygonIsValid } from './plan-pdf-room-binding'

const key = (point: PagePoint) => `${point.x}:${point.y}`
const cross = (a: PagePoint, b: PagePoint, p: PagePoint) => exactNativeOrientation(a, b, p) ?? NaN
const contains = (segment: NativePageSegment, point: PagePoint) =>
  cross(segment.start, segment.end, point) === 0 &&
  point.x >= Math.min(segment.start.x, segment.end.x) &&
  point.x <= Math.max(segment.start.x, segment.end.x) &&
  point.y >= Math.min(segment.start.y, segment.end.y) &&
  point.y <= Math.max(segment.start.y, segment.end.y)
type Edge = { start: PagePoint; end: PagePoint; sourceRefs: NativePageSegment[] }
type Face = { polygon: PagePoint[]; edges: Edge[]; exactPointKeys?: string[] }
type TopologyOptions = { topology: 'source-decimal-rational' }
export type NativeIntersectionProof = {
  point: PagePoint
  kind: 'computed-bounded-intersection'
  sourceRefs: [NativePageSegment, NativePageSegment]
  parameters: [number, number]
  arithmetic: 'source-decimal-rational'
  exactPointKey: string
}
function computedCrossing(a: NativePageSegment, b: NativePageSegment, options?: TopologyOptions) {
  const crossing = exactNativeCrossing(a, b, options)
  if (!crossing.point) return { reason: crossing.reason }
  return {
    proof: {
      point: crossing.point,
      kind: 'computed-bounded-intersection',
      sourceRefs: [a, b],
      parameters: crossing.parameters,
      arithmetic: 'source-decimal-rational',
      exactPointKey: crossing.exactPointKey,
    } as NativeIntersectionProof,
  }
}

/** Planar candidates from bounded source intersections; not room/floor classification.
 * Exact topology is opt-in for paint partitioning, not physical stroke acceptance.
 */
export function boundedNativeStrokeFaces(
  segments: readonly NativePageSegment[],
  minimumArea = 0,
  options?: TopologyOptions,
) {
  const exact =
    options?.topology === 'source-decimal-rational' ? nativeFaceRationalPredicates() : null
  const faces: Face[] = []
  const intersections: NativeIntersectionProof[] = []
  const fail = (reason: string, blockedSourceRefs: NativePageSegment[] = []) => ({
    faces: [] as Face[],
    refusalReason: reason,
    blockedSourceRefs,
    intersections: [] as NativeIntersectionProof[],
  })
  if (segments.length > 20_000) return fail('segment-limit')
  if (!Number.isFinite(minimumArea) || minimumArea < 0) return fail('invalid-minimum-area')
  if (
    new Set(
      segments.map(
        (segment) => `${segment.operationIndex}:${segment.subpathIndex}:${segment.segmentIndex}`,
      ),
    ).size !== segments.length ||
    segments.some(
      (segment) =>
        ![segment.operationIndex, segment.subpathIndex, segment.segmentIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        key(segment.start) === key(segment.end) ||
        [segment.start, segment.end].some((point) =>
          [point.x, point.y].some((value) => !Number.isFinite(value) || value < 0 || value > 1000),
        ),
    )
  )
    return fail('invalid-native-segments')
  if (
    segments.some(
      (segment) => exactNativeOrientation(segment.start, segment.end, segment.start) === null,
    )
  )
    return fail('unsupported-coordinate-precision')
  const cuts = segments.map(
    (segment) =>
      new Map([
        [key(segment.start), segment.start],
        [key(segment.end), segment.end],
      ]),
  )
  const vertexKeys = new Map(
    segments
      .flatMap((segment) => [segment.start, segment.end])
      .map((point) => [key(point), exactNativePointKey(point)]),
  )
  const canonicalPoints = new Map(
    segments
      .flatMap((segment) => [segment.start, segment.end])
      .map((point) => [exactNativePointKey(point), point]),
  )
  const order = segments
    .map((segment, index) => ({
      segment,
      index,
      left: Math.min(segment.start.x, segment.end.x),
      right: Math.max(segment.start.x, segment.end.x),
    }))
    .sort(
      (a, b) =>
        a.left - b.left ||
        a.segment.operationIndex - b.segment.operationIndex ||
        a.segment.subpathIndex - b.segment.subpathIndex ||
        a.segment.segmentIndex - b.segment.segmentIndex,
    )
  let budget = 250_000
  for (let first = 0; first < order.length; first++) {
    const a = order[first]
    if (!a) return fail('missing-segment')
    for (let second = first + 1; second < order.length; second++) {
      const b = order[second]
      if (!b) return fail('missing-segment')
      if (b.left > a.right) break
      const left = a.segment,
        right = b.segment
      if (
        Math.max(left.start.y, left.end.y) < Math.min(right.start.y, right.end.y) ||
        Math.max(right.start.y, right.end.y) < Math.min(left.start.y, left.end.y)
      )
        continue
      // Disjoint source boxes cannot contribute a cut. Keep the bounded exact
      // topology budget for possible contacts, not unrelated annotation rows.
      if (--budget < 0) return fail('intersection-budget')
      const points = [left.start, left.end, right.start, right.end].filter(
        (point) => contains(left, point) && contains(right, point),
      )
      const distinct = new Map(points.map((point) => [key(point), point]))
      let computedProof: NativeIntersectionProof | undefined
      const crossing = exact ? null : nativeEdgeCrossing([left.start, left.end], right)
      if (crossing) distinct.set(key(crossing), crossing)
      if (!distinct.size) {
        const a1 = cross(left.start, left.end, right.start),
          a2 = cross(left.start, left.end, right.end),
          b1 = cross(right.start, right.end, left.start),
          b2 = cross(right.start, right.end, left.end)
        if (
          a1 !== 0 &&
          a2 !== 0 &&
          b1 !== 0 &&
          b2 !== 0 &&
          Math.sign(a1) !== Math.sign(a2) &&
          Math.sign(b1) !== Math.sign(b2)
        ) {
          const computed = computedCrossing(left, right, options)
          if (!computed.proof) return fail(computed.reason, [left, right])
          // Reuse only identical exact rational coordinates, not nearby decimal points.
          const point = canonicalPoints.get(computed.proof.exactPointKey) ?? computed.proof.point
          computed.proof.point = point
          canonicalPoints.set(computed.proof.exactPointKey, point)
          computedProof = computed.proof
          distinct.set(key(point), point)
          if (intersections.length === 10_000) return fail('intersection-proof-limit')
          intersections.push(computed.proof)
        }
      }
      for (const [pointKey, point] of distinct) {
        const rationalKey = computedProof?.exactPointKey ?? exactNativePointKey(point)
        if (!rationalKey) return fail('unsupported-coordinate-precision', [left, right])
        const priorKey = vertexKeys.get(pointKey)
        if (priorKey && priorKey !== rationalKey)
          return fail('unrepresentable-intersection', [left, right])
        vertexKeys.set(pointKey, rationalKey)
        // Check exact cuts too, even when they follow a computed intersection.
        // Refuse numerical ambiguity; never snap or silently merge vertices.
        for (const index of [a.index, b.index])
          if (!exact && !cuts[index]?.has(pointKey))
            for (const existing of cuts[index]?.values() ?? []) {
              if (--budget < 0) return fail('intersection-consistency-budget')
              if (
                key(existing) !== pointKey &&
                Math.hypot(existing.x - point.x, existing.y - point.y) <= 1e-9
              )
                return fail('ambiguous-nearby-intersections', [left, right])
            }
        cuts[a.index]?.set(pointKey, point)
        cuts[b.index]?.set(pointKey, point)
      }
    }
  }
  const edges = new Map<string, Edge>()
  let pieces = 0
  for (const [index, segment] of segments.entries()) {
    const axis =
      Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y)
        ? 'x'
        : 'y'
    const points = [...(cuts[index]?.values() ?? [])].sort((a, b) =>
      exact
        ? exact.compareAxis(
            vertexKeys.get(key(a)) as string,
            vertexKeys.get(key(b)) as string,
            axis,
          )
        : a[axis] - b[axis],
    )
    for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
      if (++pieces > 20_000) return fail('split-edge-limit')
      const start = points[pointIndex - 1],
        end = points[pointIndex]
      if (!start || !end) return fail('missing-cut')
      const edgeKey = [key(start), key(end)].sort().join('|')
      const existing = edges.get(edgeKey)
      if (existing) existing.sourceRefs.push(segment)
      else edges.set(edgeKey, { start, end, sourceRefs: [segment] })
    }
  }
  const halfEdges: { from: PagePoint; to: PagePoint; edge: Edge; twin: number }[] = []
  const adjacency = new Map<string, number[]>()
  for (const edge of edges.values()) {
    const index = halfEdges.length
    halfEdges.push(
      { from: edge.start, to: edge.end, edge, twin: index + 1 },
      { from: edge.end, to: edge.start, edge, twin: index },
    )
    for (const halfIndex of [index, index + 1]) {
      const half = halfEdges[halfIndex]
      if (!half) return fail('missing-half-edge')
      const pointKey = key(half.from)
      const outgoing = adjacency.get(pointKey)
      if (outgoing) outgoing.push(halfIndex)
      else adjacency.set(pointKey, [halfIndex])
    }
  }
  for (const outgoing of adjacency.values())
    outgoing.sort((a, b) => {
      const left = halfEdges[a],
        right = halfEdges[b]
      if (!left || !right) return 0
      if (exact)
        return exact.compareDirections(
          vertexKeys.get(key(left.from)) as string,
          vertexKeys.get(key(left.to)) as string,
          vertexKeys.get(key(right.to)) as string,
        )
      return (
        Math.atan2(left.to.y - left.from.y, left.to.x - left.from.x) -
        Math.atan2(right.to.y - right.from.y, right.to.x - right.from.x)
      )
    })
  const next = new Map<number, number>()
  for (const outgoing of adjacency.values()) {
    for (let index = 0; index < outgoing.length; index++) {
      const current = outgoing[index],
        previous = outgoing[(index + outgoing.length - 1) % outgoing.length]
      if (current === undefined || previous === undefined || !halfEdges[current])
        return fail('missing-successor')
      next.set(halfEdges[current].twin, previous)
    }
  }
  const visited = new Set<number>()
  const vertices = [
    ...new Map(
      [...edges.values()]
        .flatMap((edge) => [edge.start, edge.end])
        .map((point) => [key(point), point]),
    ).values(),
  ]
  for (let seed = 0; seed < halfEdges.length; seed++) {
    if (visited.has(seed)) continue
    const polygon: PagePoint[] = [],
      faceEdges: Edge[] = []
    let current = seed
    while (!visited.has(current)) {
      if (--budget < 0) return fail('face-search-budget')
      visited.add(current)
      const half = halfEdges[current],
        successor = next.get(current)
      if (!half || successor === undefined) return fail('open-half-edge')
      polygon.push(half.from)
      faceEdges.push(half.edge)
      current = successor
    }
    if (current !== seed) return fail('invalid-face-walk')
    const twiceArea = polygon.reduce((sum, point, index) => {
      const following = polygon[(index + 1) % polygon.length]
      return following ? sum + point.x * following.y - following.x * point.y : sum
    }, 0)
    const exactPointKeys = polygon.map((point) => vertexKeys.get(key(point)) as string)
    if (
      polygon.length < 3 ||
      polygon.length > 100 ||
      (exact
        ? !exact.positiveAreaAtLeast(exactPointKeys, minimumArea)
        : twiceArea <= 0 || twiceArea < minimumArea * 2)
    )
      continue
    budget -= polygon.length * polygon.length
    if (budget < 0) return fail('polygon-validation-budget')
    if (exact ? !exact.simple(exactPointKeys) : !pdfPolygonIsValid(polygon)) continue
    const nodes = new Set(polygon.map(key))
    let containsOtherNode = false
    // A simple ring cannot represent holes or disconnected interior evidence.
    const bounds = {
      left: Math.min(...polygon.map((p) => p.x)),
      right: Math.max(...polygon.map((p) => p.x)),
      top: Math.min(...polygon.map((p) => p.y)),
      bottom: Math.max(...polygon.map((p) => p.y)),
    }
    const exactBounds = exact
      ? (['x', 'y'] as const).map((axis) => {
          let low = exactPointKeys[0] as string
          let high = low
          for (const pointKey of exactPointKeys) {
            if (exact.compareAxis(pointKey, low, axis) < 0) low = pointKey
            if (exact.compareAxis(pointKey, high, axis) > 0) high = pointKey
          }
          return { axis, low, high }
        })
      : []
    for (const point of vertices) {
      if (--budget < 0) return fail('interior-search-budget')
      const exactPointKey = vertexKeys.get(key(point)) as string
      if (
        nodes.has(key(point)) ||
        (exact &&
          exactBounds.some(
            ({ axis, low, high }) =>
              exact.compareAxis(exactPointKey, low, axis) < 0 ||
              exact.compareAxis(exactPointKey, high, axis) > 0,
          )) ||
        (!exact &&
          (point.x < bounds.left ||
            point.x > bounds.right ||
            point.y < bounds.top ||
            point.y > bounds.bottom))
      )
        continue
      budget -= polygon.length
      if (budget < 0) return fail('interior-search-budget')
      if (
        exact
          ? exact.location(exactPointKeys, exactPointKey) === 'inside'
          : pdfPointInside(point, polygon)
      ) {
        containsOtherNode = true
        break
      }
    }
    if (containsOtherNode) continue
    faces.push({ polygon, edges: faceEdges, ...(exact ? { exactPointKeys } : {}) })
    if (faces.length > 1000) return fail('face-count-limit')
  }
  return { faces, refusalReason: null, blockedSourceRefs: [] as NativePageSegment[], intersections }
}
