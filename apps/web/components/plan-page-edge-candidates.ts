import type { NativePageSegment } from '@/lib/projects/plan-pdf-opening-endpoint'
import type { PageContourPoint, PlanPagePreview } from './plan-page-contour-editor-model'

export type SourceEdgeCandidate = {
  segment: NativePageSegment
  gapPageUnits: number
  overlapPageUnits: number
}

export type SourceEdgeCandidates =
  | { status: 'checked'; candidates: SourceEdgeCandidate[] }
  | { status: 'held'; reason: 'invalid-edge' | 'candidate-limit' }

const MAX_CANDIDATES = 20
const MAX_SEGMENTS = 20_000
const MAX_GAP_PAGE_UNITS = 3
const MAX_ANGLE_SINE = 0.02

/** Nearby ink for visual review only; proximity never proves a physical wall or snaps a vertex. */
export function sourceEdgeCandidates(
  edge: readonly [PageContourPoint, PageContourPoint],
  segments: readonly NativePageSegment[],
  page: Pick<PlanPagePreview, 'width' | 'height'>,
): SourceEdgeCandidates {
  if (
    segments.length > MAX_SEGMENTS ||
    ![page.width, page.height, ...edge.flatMap((point) => [point.x, point.y])].every(
      Number.isFinite,
    ) ||
    page.width <= 0 ||
    page.height <= 0
  )
    return { status: 'held', reason: 'invalid-edge' }

  const pagePoint = (point: PageContourPoint) => ({
    x: (point.x * page.width) / 1000,
    y: (point.y * page.height) / 1000,
  })
  const start = pagePoint(edge[0])
  const end = pagePoint(edge[1])
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length <= 0) return { status: 'held', reason: 'invalid-edge' }

  const candidates: SourceEdgeCandidate[] = []
  const refs = new Set<string>()
  for (const segment of segments) {
    if (![segment.start.x, segment.start.y, segment.end.x, segment.end.y].every(Number.isFinite))
      return { status: 'held', reason: 'invalid-edge' }
    const ref = `${segment.operationIndex}:${segment.subpathIndex}:${segment.segmentIndex}`
    if (refs.has(ref)) return { status: 'held', reason: 'invalid-edge' }
    refs.add(ref)

    const a = pagePoint(segment.start)
    const b = pagePoint(segment.end)
    const sx = b.x - a.x
    const sy = b.y - a.y
    const segmentLength = Math.hypot(sx, sy)
    if (segmentLength <= 0) continue
    const angleSine = Math.abs(dx * sy - dy * sx) / (length * segmentLength)
    if (angleSine > MAX_ANGLE_SINE) continue

    const alongA = ((a.x - start.x) * dx + (a.y - start.y) * dy) / length
    const alongB = ((b.x - start.x) * dx + (b.y - start.y) * dy) / length
    const overlapPageUnits =
      Math.min(length, Math.max(alongA, alongB)) - Math.max(0, Math.min(alongA, alongB))
    if (overlapPageUnits <= 0) continue

    const gapA = Math.abs((a.x - start.x) * dy - (a.y - start.y) * dx) / length
    const gapB = Math.abs((b.x - start.x) * dy - (b.y - start.y) * dx) / length
    const gapPageUnits = Math.max(gapA, gapB)
    if (gapPageUnits > MAX_GAP_PAGE_UNITS) continue
    candidates.push({ segment, gapPageUnits, overlapPageUnits })
    if (candidates.length > MAX_CANDIDATES) return { status: 'held', reason: 'candidate-limit' }
  }
  candidates.sort(
    (a, b) =>
      a.gapPageUnits - b.gapPageUnits ||
      b.overlapPageUnits - a.overlapPageUnits ||
      a.segment.operationIndex - b.segment.operationIndex ||
      a.segment.subpathIndex - b.segment.subpathIndex ||
      a.segment.segmentIndex - b.segment.segmentIndex,
  )
  return { status: 'checked', candidates }
}
