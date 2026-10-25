import {
  exactNativeOrientation,
  exactNativeParallelogramFourthPointKey,
  exactNativePointKey,
} from './plan-native-exact-intersections'
import { exactNativeOpeningFrameShape } from './plan-native-opening-frames'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { PDF_NATIVE_MAX_PATHS } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

type CompositeFrame = {
  polygon: PagePoint[]
  edges: NativePageSegment[]
  repaintAliases: NativePageSegment[][]
  jambContacts: {
    edge: NativePageSegment
    sources: NativePageSegment[]
    coverage: 'complete' | 'unproved'
    filledBoundarySources: NativePageSegment[]
    filledBoundaryCoverage: 'complete' | 'unproved'
  }[]
  semanticStatus: 'unclassified'
  physicalPassageAccepted: false
  wallOwnershipConfirmed: false
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
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated ||
    work.paths.length > PDF_NATIVE_MAX_PATHS ||
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
  const filledSegments: NativePageSegment[] = []
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
    if (path.paint !== 'stroke' && path.closed && !excluded.has(path.operationIndex)) {
      const points = path.points
      for (let i = 0; i < points.length; i++) {
        const start = points[i] as PagePoint
        const end = points[(i + 1) % points.length] as PagePoint
        if (key(start) === key(end)) continue
        filledSegments.push({
          operationIndex: path.operationIndex,
          subpathIndex: path.subpathIndex,
          segmentIndex: i,
          start,
          end,
        })
        if (filledSegments.length > 20_000) return finish('composite-frame-work-limit')
      }
    }
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
  const onSourceLine = (edges: NativePageSegment[]) => {
    const index = new Map<string, NativePageSegment[]>()
    for (const edge of edges) {
      const line =
        edge.start.x === edge.end.x
          ? `x:${edge.start.x}`
          : edge.start.y === edge.end.y
            ? `y:${edge.start.y}`
            : null
      if (!line) continue
      const group = index.get(line) ?? []
      group.push(edge)
      index.set(line, group)
    }
    return index
  }
  const strokeLines = onSourceLine(segments)
  const filledLines = onSourceLine(filledSegments)
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
  const addCycle = (polygon: PagePoint[], edges: NativePageSegment[]) => {
    const identity = edges.map(ref).sort().join('|')
    if (visited.has(identity)) return
    visited.add(identity)
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
      wallOwnershipConfirmed: false,
      closesFloorBoundary: false,
    })
  }

  // Enumerate two adjacent edges, then look for the opposite corner among the
  // first corner's actual neighbours. This avoids walking unrelated four-edge
  // chains in dense tables and never invents a missing fourth source stroke.
  for (const [pointKey, entry] of at) {
    const edge = entry[0]
    if (!edge) continue
    const firstPoint = key(edge.start) === pointKey ? edge.start : edge.end
    for (const first of entry) {
      const secondPoint = key(first.start) === pointKey ? first.end : first.start
      for (const second of at.get(key(secondPoint)) ?? []) {
        if (ref(first) === ref(second)) continue
        const thirdPoint = key(second.start) === key(secondPoint) ? second.end : second.start
        if (key(thirdPoint) === pointKey) continue
        const fourthPointKey = exactNativeParallelogramFourthPointKey(
          firstPoint,
          secondPoint,
          thirdPoint,
        )
        if (!fourthPointKey || !at.has(fourthPointKey)) continue
        for (const fourth of entry) {
          if (--budget < 0) {
            exhausted = true
            break
          }
          if (ref(first) === ref(fourth)) continue
          const fourthPoint = key(fourth.start) === pointKey ? fourth.end : fourth.start
          if (key(fourthPoint) !== fourthPointKey) continue
          const polygon = [firstPoint, secondPoint, thirdPoint, fourthPoint]
          if (!exactNativeOpeningFrameShape(polygon, scale)) continue
          for (const third of at.get(key(thirdPoint)) ?? []) {
            if (ref(third) === ref(second) || ref(third) === ref(fourth)) continue
            const other = key(third.start) === key(thirdPoint) ? third.end : third.start
            if (key(other) !== key(fourthPoint)) continue
            addCycle(polygon, [first, second, third, fourth])
            if (exhausted) break
          }
          if (exhausted) break
        }
        if (exhausted) break
      }
      if (exhausted) break
    }
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
      const line = start.x === end.x ? `x:${start.x}` : start.y === end.y ? `y:${start.y}` : null
      const sources = (line ? (strokeLines.get(line) ?? []) : segments).filter((other) => {
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
      // A literal filled-path boundary is evidence of paint contact only. Its material,
      // final visibility and wall ownership still require independent confirmation.
      const filledBoundarySources = (line ? (filledLines.get(line) ?? []) : filledSegments).filter(
        (other) => {
          if (--budget < 0) {
            exhausted = true
            return false
          }
          return (
            exactNativeOrientation(start, end, other.start) === 0 &&
            exactNativeOrientation(start, end, other.end) === 0 &&
            Math.min(other.start[axis], other.end[axis]) <= low &&
            Math.max(other.start[axis], other.end[axis]) >= high &&
            (Math.min(other.start[axis], other.end[axis]) < low ||
              Math.max(other.start[axis], other.end[axis]) > high)
          )
        },
      )
      candidate.jambContacts.push({
        edge,
        sources,
        coverage: sources.length ? 'complete' : 'unproved',
        filledBoundarySources,
        filledBoundaryCoverage: filledBoundarySources.length ? 'complete' : 'unproved',
      })
    }
    if (exhausted) return finish('composite-frame-work-limit')
    candidates.push(candidate)
    if (candidates.length > 100) return finish('composite-frame-candidate-limit')
  }
  return finish(null)
}
