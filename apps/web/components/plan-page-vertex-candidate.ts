import type { PlanPageVertexProof } from '@uyut/db'
import {
  exactNativeCrossing,
  exactNativeDirectionsParallel,
  exactNativePointKey,
} from '@/lib/projects/plan-native-exact-intersections'
import type { NativePageSegment } from '@/lib/projects/plan-pdf-opening-endpoint'
import {
  finiteContourPoint,
  type PageContourPoint,
  type PlanPagePreview,
  snapPageContourPoint,
} from './plan-page-contour-editor-model'

export type SourceContourVertexCandidate =
  | {
      kind: 'candidate'
      point: PageContourPoint
      distance: number
      vertexProof?: PlanPageVertexProof
    }
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'held'; reason: 'intersection-budget' | 'unsupported-precision' }

const MAX_NEARBY_SEGMENTS = 200

/** Screen distance narrows the search only; saved evidence uses exact source arithmetic. */
export function snapPageSourceContourPoint(
  point: PageContourPoint,
  nativePoints: PageContourPoint[],
  page: Pick<PlanPagePreview, 'width' | 'height'>,
  segments: readonly NativePageSegment[],
  vertexIndex: number,
): SourceContourVertexCandidate {
  const native = snapPageContourPoint(point, nativePoints, page)
  if (native.kind === 'candidate' && native.distance === 0) return native
  if (
    !finiteContourPoint(point) ||
    ![page.width, page.height].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isSafeInteger(vertexIndex) ||
    vertexIndex < 0 ||
    vertexIndex >= 100
  )
    return { kind: 'none' }
  if (segments.length > 20_000) return { kind: 'held', reason: 'intersection-budget' }

  const distance = (candidate: PageContourPoint) =>
    Math.hypot(
      ((point.x - candidate.x) * page.width) / 1000,
      ((point.y - candidate.y) * page.height) / 1000,
    )
  const nearby: NativePageSegment[] = []
  const refs = new Set<string>()
  for (const segment of segments) {
    if (!finiteContourPoint(segment.start) || !finiteContourPoint(segment.end))
      return { kind: 'held', reason: 'unsupported-precision' }
    const ref = `${segment.operationIndex}:${segment.subpathIndex}:${segment.segmentIndex}`
    if (refs.has(ref)) return { kind: 'ambiguous' }
    refs.add(ref)
    const dx = ((segment.end.x - segment.start.x) * page.width) / 1000
    const dy = ((segment.end.y - segment.start.y) * page.height) / 1000
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) continue
    const px = ((point.x - segment.start.x) * page.width) / 1000
    const py = ((point.y - segment.start.y) * page.height) / 1000
    const along = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
    if (Math.hypot(px - along * dx, py - along * dy) > 3) continue
    nearby.push(segment)
    if (nearby.length > MAX_NEARBY_SEGMENTS) return { kind: 'held', reason: 'intersection-budget' }
  }

  const crossings: Extract<SourceContourVertexCandidate, { kind: 'candidate' }>[] = []
  const unsupportedDistances: number[] = []
  const nodeKeys = new Set(nativePoints.map((p) => `${p.x}:${p.y}`))
  for (let first = 0; first < nearby.length; first++) {
    const a = nearby[first]
    if (!a) continue
    for (let second = first + 1; second < nearby.length; second++) {
      const b = nearby[second]
      if (!b) continue
      const crossing = exactNativeCrossing(a, b)
      if (!crossing.point) {
        if (crossing.reason === 'unbounded-computed-intersection') continue
        if (
          crossing.reason === 'ill-conditioned-intersection' &&
          exactNativeDirectionsParallel(a, b) === true
        )
          continue
        return { kind: 'held', reason: 'unsupported-precision' }
      }
      const gap = distance(crossing.point)
      if (gap > 3 || nodeKeys.has(`${crossing.point.x}:${crossing.point.y}`)) continue
      // Existing contour topology consumes decimal coordinates. A rational key
      // must round-trip exactly before this proposal can enter that contract.
      if (exactNativePointKey(crossing.point) !== crossing.exactPointKey) {
        unsupportedDistances.push(gap)
        continue
      }
      crossings.push({
        kind: 'candidate',
        point: crossing.point,
        distance: gap,
        vertexProof: {
          kind: 'bounded-native-rational-crossing',
          vertexIndex,
          exactPointKey: crossing.exactPointKey,
          segments: structuredClone([a, b]),
        },
      })
    }
  }
  const candidates = [...crossings, ...(native.kind === 'candidate' ? [native] : [])].sort(
    (a, b) => a.distance - b.distance,
  )
  const first = candidates[0]
  if (!first)
    return unsupportedDistances.length ? { kind: 'held', reason: 'unsupported-precision' } : native
  if (unsupportedDistances.some((gap) => gap <= first.distance + 0.25))
    return { kind: 'held', reason: 'unsupported-precision' }
  // Different source pairs at one location are competing evidence, not a tie
  // resolved by array order. Only an exact original node takes precedence above.
  if (
    native.kind === 'ambiguous' ||
    (candidates[1] && candidates[1].distance - first.distance <= 0.25)
  )
    return { kind: 'ambiguous' }
  return first
}
