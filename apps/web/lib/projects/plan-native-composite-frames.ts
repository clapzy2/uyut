import { exactNativeOrientation, exactNativePointKey } from './plan-native-exact-intersections'
import { exactNativeOpeningFrameShape } from './plan-native-opening-frames'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

type CompositeFrame = {
  polygon: PagePoint[]
  edges: NativePageSegment[]
  repaintAliases: NativePageSegment[][]
  jambContacts: {
    edge: NativePageSegment
    sources: NativePageSegment[]
    coverage: 'complete' | 'unproved'
  }[]
  semanticStatus: 'unclassified'
  physicalPassageAccepted: false
  closesFloorBoundary: false
}
const ref = (edge: NativePageSegment) =>
  `${edge.operationIndex}:${edge.subpathIndex}:${edge.segmentIndex}`
const key = (point: PagePoint) => exactNativePointKey(point) as string

/** Exact source cycles for review. Rectangle geometry alone grants no opening or floor authority. */
export function nativeCompositeFrameEvidence(work: PdfLinework, scale: { x: number; y: number }) {
  const candidates: CompositeFrame[] = []
  const finish = (refusalReason: string | null) => ({
    candidates: refusalReason ? [] : structuredClone(candidates),
    refusalReason,
    semanticStatus: 'unclassified' as const,
    physicalPassageAccepted: false as const,
    closesFloorBoundary: false as const,
  })
  if (
    work.truncated ||
    work.unsupportedPaths > 0 ||
    work.unsupportedContexts > 0 ||
    work.curvePathsTruncated ||
    work.paths.length > 3000 ||
    ![scale.x, scale.y].every((n) => Number.isFinite(n) && n > 0)
  )
    return finish('incomplete-composite-source')
  const excluded = new Set(
    [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].map(
      (item) => item.operationIndex,
    ),
  )
  const refs = new Set<string>()
  const segments: NativePageSegment[] = []
  for (const path of work.paths) {
    const pathRef = `${path.operationIndex}:${path.subpathIndex}`
    if (
      refs.has(pathRef) ||
      ![path.operationIndex, path.subpathIndex].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(path.points) ||
      path.points.some((p) => !p || exactNativePointKey(p) === null)
    )
      return finish('invalid-composite-provenance')
    refs.add(pathRef)
    if (path.paint !== 'stroke' || path.points.length !== 2 || excluded.has(path.operationIndex))
      continue
    const start = path.points[0] as PagePoint,
      end = path.points[1] as PagePoint
    if (key(start) === key(end)) continue
    segments.push({
      operationIndex: path.operationIndex,
      subpathIndex: path.subpathIndex,
      segmentIndex: 0,
      start,
      end,
    })
  }
  const at = new Map<string, NativePageSegment[]>()
  for (const edge of segments)
    for (const point of [edge.start, edge.end]) {
      const connected = at.get(key(point)) ?? []
      connected.push(edge)
      at.set(key(point), connected)
    }
  const cycles = new Map<string, CompositeFrame>()
  const visited = new Set<string>()
  let budget = 200_000
  let exhausted = false
  const walk = (points: PagePoint[], edges: NativePageSegment[]) => {
    if (--budget < 0) {
      exhausted = true
      return
    }
    const last = points.at(-1) as PagePoint
    if (edges.length === 4) {
      if (key(last) !== key(points[0] as PagePoint)) return
      const identity = edges.map(ref).sort().join('|')
      if (visited.has(identity)) return
      visited.add(identity)
      const polygon = points.slice(0, 4)
      if (!exactNativeOpeningFrameShape(polygon, scale)) return
      const geometry = polygon.map(key).sort().join('|')
      const existing = cycles.get(geometry)
      if (existing) {
        if (existing.repaintAliases.length >= 100) {
          exhausted = true
          return
        }
        existing.repaintAliases.push(edges)
        return
      }
      cycles.set(geometry, {
        polygon,
        edges,
        repaintAliases: [],
        jambContacts: [],
        semanticStatus: 'unclassified',
        physicalPassageAccepted: false,
        closesFloorBoundary: false,
      })
      return
    }
    for (const edge of at.get(key(last)) ?? []) {
      if (--budget < 0) {
        exhausted = true
        return
      }
      if (edges.some((used) => ref(used) === ref(edge))) continue
      const next = key(edge.start) === key(last) ? edge.end : edge.start
      if (edges.length < 3 && points.some((p) => key(p) === key(next))) continue
      walk([...points, next], [...edges, edge])
      if (exhausted) return
    }
  }
  for (const entry of at.values()) {
    const edge = entry[0]
    if (edge) walk([edge.start], [])
    if (exhausted) return finish('composite-frame-work-limit')
  }
  for (const candidate of cycles.values()) {
    const lengths = candidate.polygon.map((point, i) => {
      const next = candidate.polygon[(i + 1) % 4] as PagePoint
      return Math.hypot((next.x - point.x) * scale.x, (next.y - point.y) * scale.y)
    })
    const shortest = Math.min(...lengths),
      longest = Math.max(...lengths)
    if (longest < 5 || shortest / longest > 0.4) continue
    const owned = new Set([candidate.edges, ...candidate.repaintAliases].flat().map(ref))
    for (let i = 0; i < 4; i++) {
      if (lengths[i] !== shortest) continue
      const start = candidate.polygon[i] as PagePoint,
        end = candidate.polygon[(i + 1) % 4] as PagePoint
      const edge = candidate.edges[i] as NativePageSegment
      const axis = start.x === end.x ? 'y' : 'x'
      const low = Math.min(start[axis], end[axis]),
        high = Math.max(start[axis], end[axis])
      const sources = segments.filter((other) => {
        if (--budget < 0) {
          exhausted = true
          return false
        }
        return (
          !owned.has(ref(other)) &&
          exactNativeOrientation(start, end, other.start) === 0 &&
          exactNativeOrientation(start, end, other.end) === 0 &&
          Math.min(other.start[axis], other.end[axis]) <= low &&
          Math.max(other.start[axis], other.end[axis]) >= high &&
          (Math.min(other.start[axis], other.end[axis]) < low ||
            Math.max(other.start[axis], other.end[axis]) > high)
        )
      })
      candidate.jambContacts.push({
        edge,
        sources,
        coverage: sources.length ? 'complete' : 'unproved',
      })
    }
    if (exhausted) return finish('composite-frame-work-limit')
    candidates.push(candidate)
    if (candidates.length > 100) return finish('composite-frame-candidate-limit')
  }
  return finish(null)
}
