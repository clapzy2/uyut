import type { PagePoint } from './plan-pdf-linework'
import { type NativePageSegment, nativeEdgeCrossing } from './plan-pdf-opening-endpoint'
import { pdfPointInside, pdfPolygonIsValid } from './plan-pdf-room-binding'

const key = (point: PagePoint) => `${point.x}:${point.y}`
const cross = (a: PagePoint, b: PagePoint, p: PagePoint) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
const contains = (segment: NativePageSegment, point: PagePoint) =>
  cross(segment.start, segment.end, point) === 0 &&
  point.x >= Math.min(segment.start.x, segment.end.x) &&
  point.x <= Math.max(segment.start.x, segment.end.x) &&
  point.y >= Math.min(segment.start.y, segment.end.y) &&
  point.y <= Math.max(segment.start.y, segment.end.y)
type Edge = { start: PagePoint; end: PagePoint; sourceRefs: NativePageSegment[] }
type Face = { polygon: PagePoint[]; edges: Edge[] }

/** Planar candidates from bounded source intersections; not room/floor classification. */
export function boundedNativeStrokeFaces(segments: readonly NativePageSegment[]) {
  const faces: Face[] = []
  const fail = (reason: string, blockedSourceRefs: NativePageSegment[] = []) => ({
    faces: [] as Face[],
    refusalReason: reason,
    blockedSourceRefs,
  })
  if (segments.length > 20_000) return fail('segment-limit')
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
  const cuts = segments.map(
    (segment) =>
      new Map([
        [key(segment.start), segment.start],
        [key(segment.end), segment.end],
      ]),
  )
  const order = segments
    .map((segment, index) => ({
      segment,
      index,
      left: Math.min(segment.start.x, segment.end.x),
      right: Math.max(segment.start.x, segment.end.x),
    }))
    .sort((a, b) => a.left - b.left || a.index - b.index)
  let budget = 250_000
  for (let first = 0; first < order.length; first++) {
    const a = order[first]
    if (!a) return fail('missing-segment')
    for (let second = first + 1; second < order.length; second++) {
      const b = order[second]
      if (!b) return fail('missing-segment')
      if (b.left > a.right) break
      if (--budget < 0) return fail('intersection-budget')
      const left = a.segment,
        right = b.segment
      if (
        Math.max(left.start.y, left.end.y) < Math.min(right.start.y, right.end.y) ||
        Math.max(right.start.y, right.end.y) < Math.min(left.start.y, left.end.y)
      )
        continue
      const points = [left.start, left.end, right.start, right.end].filter(
        (point) => contains(left, point) && contains(right, point),
      )
      const distinct = new Map(points.map((point) => [key(point), point]))
      if (distinct.size > 1 && left.start.x !== left.end.x && left.start.y !== left.end.y)
        return fail('unsupported-diagonal-overlap', [left, right])
      const crossing = nativeEdgeCrossing([left.start, left.end], right)
      if (crossing) distinct.set(key(crossing), crossing)
      if (!distinct.size) {
        const a1 = cross(left.start, left.end, right.start),
          a2 = cross(left.start, left.end, right.end),
          b1 = cross(right.start, right.end, left.start),
          b2 = cross(right.start, right.end, left.end)
        if (Math.sign(a1) !== Math.sign(a2) && Math.sign(b1) !== Math.sign(b2))
          return fail('unsupported-diagonal-crossing', [left, right])
      }
      for (const [pointKey, point] of distinct) {
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
    const points = [...(cuts[index]?.values() ?? [])].sort((a, b) => a[axis] - b[axis])
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
    if (twiceArea <= 0 || polygon.length < 3 || polygon.length > 100) continue
    budget -= polygon.length * polygon.length
    if (budget < 0) return fail('polygon-validation-budget')
    if (!pdfPolygonIsValid(polygon)) continue
    const nodes = new Set(polygon.map(key))
    let containsOtherNode = false
    // A simple ring cannot represent holes or disconnected interior evidence.
    for (const edge of edges.values())
      for (const point of [edge.start, edge.end]) {
        budget -= polygon.length
        if (budget < 0) return fail('interior-search-budget')
        if (!nodes.has(key(point)) && pdfPointInside(point, polygon)) containsOtherNode = true
      }
    if (containsOtherNode) continue
    faces.push({ polygon, edges: faceEdges })
    if (faces.length > 1000) return fail('face-count-limit')
  }
  return { faces, refusalReason: null, blockedSourceRefs: [] as NativePageSegment[] }
}
