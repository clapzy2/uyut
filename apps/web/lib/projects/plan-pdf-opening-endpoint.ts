import type { PlanPageEndpointProof, PlanPageSegmentRef } from '@uyut/db'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'

export type NativePageSegment = PlanPageSegmentRef & { start: PagePoint; end: PagePoint }
const MAX_SEGMENTS = 20_000
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y

/** Only real straight strokes; source identities survive without coordinate rounding. */
export function nativePageSegments(work: PdfLinework): NativePageSegment[] {
  if (work.truncated || work.unsupportedContexts || work.unsupportedPaths) return []
  const result: NativePageSegment[] = []
  for (const path of work.paths) {
    if (path.paint !== 'stroke' && path.paint !== 'fill-stroke') continue
    if (!Number.isSafeInteger(path.operationIndex) || !Number.isSafeInteger(path.subpathIndex))
      continue
    const count = path.closed ? path.points.length : path.points.length - 1
    for (let segmentIndex = 0; segmentIndex < count; segmentIndex++) {
      const start = path.points[segmentIndex]
      const end = path.points[(segmentIndex + 1) % path.points.length]
      if (!start || !end || samePoint(start, end)) continue
      result.push({
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex,
        start,
        end,
      })
      if (result.length > MAX_SEGMENTS) return []
    }
  }
  return result
}

/** Axis-aligned bounded crossing only: no extension, approximate snap or diagonal rounding. */
export function nativeEdgeCrossing(
  edge: readonly [PagePoint, PagePoint],
  segment: NativePageSegment,
): PagePoint | undefined {
  const [a, b] = edge
  const { start, end } = segment
  if (![a, b, start, end].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return
  const within = (value: number, low: number, high: number) =>
    value >= Math.min(low, high) && value <= Math.max(low, high)
  if (
    a.y === b.y &&
    a.x !== b.x &&
    start.x === end.x &&
    start.y !== end.y &&
    within(start.x, a.x, b.x) &&
    within(a.y, start.y, end.y)
  )
    return { x: start.x, y: a.y }
  if (
    a.x === b.x &&
    a.y !== b.y &&
    start.y === end.y &&
    start.x !== end.x &&
    within(start.y, a.y, b.y) &&
    within(a.x, start.x, end.x)
  )
    return { x: a.x, y: start.y }
}

export function sourceOpeningEndpoint(
  point: PagePoint,
  proof: PlanPageEndpointProof | undefined,
  edge: readonly [PagePoint, PagePoint],
  nativePoints: ReadonlySet<string>,
  segments: readonly NativePageSegment[],
): boolean {
  if (!proof) return nativePoints.has(`${point.x}:${point.y}`)
  if (proof.kind !== 'native-edge-crossing') return false
  const matches = segments.filter(
    (segment) =>
      segment.operationIndex === proof.operationIndex &&
      segment.subpathIndex === proof.subpathIndex &&
      segment.segmentIndex === proof.segmentIndex,
  )
  if (matches.length !== 1 || !matches[0]) return false
  const crossing = nativeEdgeCrossing(edge, matches[0])
  return crossing !== undefined && samePoint(point, crossing)
}
