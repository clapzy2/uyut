import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { NativeTextAnchors } from './plan-document'
import { type NativeClosedStrokeRun, nativeClosedStrokeRuns } from './plan-native-closed-runs'
import {
  exactNativeDirectionsParallel,
  exactNativeOrientation,
  exactNativePolygonContains,
  exactNativePolygonsOverlap,
  exactNativeSegmentCrossesPolygonInterior,
  exactNativeSegmentsTouch,
} from './plan-native-exact-intersections'
import {
  type NativeFloorMarkerLeader,
  nativeFloorMarkerLeaders,
} from './plan-native-floor-marker-leaders'
import { nativeNumberCircleCandidates, numberCircleLoop } from './plan-native-number-circles'
import { nativeOpeningFrameCandidates } from './plan-native-opening-frames'
import type { Bounds, PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'

type Input = {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: NativeTextAnchors['source']
}
type BoundarySupport = {
  kind: 'paint-boundary' | 'frame-side' | 'profile-side'
  id: string
  edge: NativePageSegment
}
type PaintPrimitive = { path: PdfVectorPath; polygon: PagePoint[]; bounds: Bounds }
type PaintGroup = { color: string; primitives: PaintPrimitive[]; supports: BoundarySupport[] }
export type NativeFloorCavity = {
  id: string
  polygon: PagePoint[]
  boundaries: { start: PagePoint; end: PagePoint; supports: BoundarySupport[] }[]
  paintColor: string
  markerLabelIds: string[]
  markerStatus: 'unambiguous' | 'ambiguous' | 'unmarked' | 'unavailable'
  closureIds: string[]
  unknownInteriorStrokeCount: number
  omittedBoundaryInkCount: number
}

const MAX_WORK = 2_000_000
const MAX_CAVITIES = 100
const same = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const refKey = (edge: NativePageSegment) =>
  `${edge.operationIndex}:${edge.subpathIndex}:${edge.segmentIndex}`
const boundsOf = (points: PagePoint[]): Bounds => ({
  left: Math.min(...points.map((point) => point.x)),
  right: Math.max(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  bottom: Math.max(...points.map((point) => point.y)),
})
const boundsOverlap = (a: Bounds, b: Bounds) =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
function pathEdges(path: PdfVectorPath): NativePageSegment[] {
  const first = path.points[0]
  const last = path.points.at(-1)
  const points = first && last && same(first, last) ? path.points.slice(0, -1) : path.points
  return points.map((start, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start,
    end: points[(segmentIndex + 1) % points.length] as PagePoint,
  }))
}
function sharedSpan(a: Pick<NativePageSegment, 'start' | 'end'>, b: NativePageSegment) {
  if (!boundsOverlap(boundsOf([a.start, a.end]), boundsOf([b.start, b.end]))) return null
  if (
    exactNativeOrientation(a.start, a.end, b.start) !== 0 ||
    exactNativeOrientation(a.start, a.end, b.end) !== 0
  )
    return null
  const axis = a.start.x === a.end.x ? 'y' : 'x'
  const from = Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis]))
  const to = Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis]))
  return from < to ? { axis, from, to } : null
}
const clippingPolygon = (polygon: PagePoint[]): Polygon => [
  polygon.map((point) => [point.x, point.y]),
]
function exactlyZeroArea(points: PagePoint[]): boolean {
  const first = points[0]
  if (!first) return false
  const second = points.find((point) => !same(first, point))
  return !second || points.every((point) => exactNativeOrientation(first, second, point) === 0)
}

/** Source-backed negative-space cells. Logical opening strips are not physical wall material. */
export function nativeFloorCavityCandidates(input: Input) {
  const loops = nativeClosedStrokeRuns({ ...input, minimumEdges: 6 })
  const circles = nativeNumberCircleCandidates(input)
  let frames: ReturnType<typeof nativeOpeningFrameCandidates>
  const cavities: NativeFloorCavity[] = []
  let markerLeaders: NativeFloorMarkerLeader[] = []
  let markerLeaderIssues: { labelId: string; reason: string }[] = []
  const unprovedCavities: {
    polygon: PagePoint[] | null
    bounds: Bounds
    vertexCount: number
    reason: string
  }[] = []
  const thresholds: { id: string; frameId: string; polygon: PagePoint[]; paintColors: string[] }[] =
    []
  const closures: {
    id: string
    polygon: PagePoint[]
    paintColors: string[]
    sourceKind: NativeClosedStrokeRun['sourceKind']
    remainingSegments: NativePageSegment[]
  }[] = []
  let unprovedCavityCount = 0
  let work = MAX_WORK
  const exhausted = Symbol('floor-cavity-work-limit')
  const spend = (count = 1) => {
    work -= count
    if (work < 0) throw exhausted
  }
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    basis: 'source-paint-and-documented-opening-cavities' as const,
    source: { ...input.native.source },
    originalPdfSha256: input.native.originalPdfSha256,
    cavities: refusalReason ? [] : structuredClone(cavities),
    markerLeaders: refusalReason ? [] : markerLeaders,
    markerLeaderIssues: refusalReason ? [] : markerLeaderIssues,
    thresholds: refusalReason ? [] : structuredClone(thresholds),
    closures: refusalReason ? [] : structuredClone(closures),
    unprovedCavityCount,
    unprovedCavities: refusalReason ? [] : structuredClone(unprovedCavities),
    markersAvailable: circles.status === 'draft',
    unresolvedMarkerLabelIds: refusalReason
      ? []
      : circles.cues
          .filter((cue) => !cavities.some((cell) => cell.markerLabelIds.includes(cue.labelId)))
          .map((cue) => cue.labelId),
    readOnly: true as const,
    completeFloorInventory: false as const,
    roomOwnershipConfirmed: false as const,
    physicalPassagesAccepted: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  if (loops.refusalReason) return finish(loops.refusalReason)
  try {
    frames = nativeOpeningFrameCandidates(input)
  } catch {
    return finish('source-frame-unavailable')
  }
  if (frames.refusalReason) return finish(frames.refusalReason)
  try {
    const omissions = [
      ...(input.work.skippedCurveBounds ?? []),
      ...(input.work.clippedPathBounds ?? []),
    ]
    const omittedOps = new Set(omissions.map((item) => item.operationIndex))
    const paintOps = new Map<number, PdfVectorPath[]>()
    for (const path of input.work.paths) {
      if (path.paint === 'stroke') continue
      const siblings = paintOps.get(path.operationIndex) ?? []
      siblings.push(path)
      paintOps.set(path.operationIndex, siblings)
    }
    const groups = new Map<string, PaintGroup>()
    const unresolvedPaint: { color: string | null; bounds: Bounds }[] = []
    for (const siblings of paintOps.values()) {
      spend()
      const color = siblings[0]?.fillColor
      const operationBounds = boundsOf(siblings.flatMap((path) => path.points))
      if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
        unresolvedPaint.push({ color: null, bounds: operationBounds })
        continue
      }
      if (siblings.length > 50) return finish('paint-operation-limit')
      const primitives: PaintPrimitive[] = []
      for (const path of siblings) {
        spend()
        if (path.fillColor !== color || !path.closed || omittedOps.has(path.operationIndex)) {
          primitives.length = 0
          break
        }
        const polygon = pathEdges(path).map((edge) => edge.start)
        // A fill-stroke command can contain an exactly collinear, zero-area
        // subpath. It contributes no paint; its original stroke remains in work.
        if (exactlyZeroArea(polygon)) continue
        if (polygon.length < 3 || polygon.length > 100 || !pdfPolygonIsValid(polygon)) {
          primitives.length = 0
          break
        }
        primitives.push({ path, polygon, bounds: boundsOf(polygon) })
      }
      // Without a recorded fill-rule, overlapping compound subpaths are not a union.
      let independent = true
      for (let i = 0; i < primitives.length; i++) {
        for (const other of primitives.slice(i + 1)) {
          const first = primitives[i] as PaintPrimitive
          spend(first.polygon.length * other.polygon.length)
          if (exactNativePolygonsOverlap(first.polygon, other.polygon) !== false)
            independent = false
        }
      }
      if (
        !primitives.length &&
        siblings.every(
          (path) =>
            path.closed &&
            path.fillColor === color &&
            !omittedOps.has(path.operationIndex) &&
            exactlyZeroArea(pathEdges(path).map((edge) => edge.start)),
        )
      )
        continue
      if (!primitives.length || !independent) {
        unresolvedPaint.push({ color, bounds: operationBounds })
        continue
      }
      const group = groups.get(color) ?? { color, primitives: [], supports: [] }
      group.primitives.push(...primitives)
      group.supports.push(
        ...primitives.flatMap((primitive) =>
          pathEdges(primitive.path).map((edge) => ({
            kind: 'paint-boundary' as const,
            id: `native-paint-${edge.operationIndex}:${edge.subpathIndex}`,
            edge,
          })),
        ),
      )
      groups.set(color, group)
    }
    if (groups.size > 32) return finish('paint-color-limit')

    const cover = (edge: Pick<NativePageSegment, 'start' | 'end'>, sources: BoundarySupport[]) => {
      const intervals: { from: number; to: number; support: BoundarySupport }[] = []
      for (const support of sources) {
        spend()
        const span = sharedSpan(edge, support.edge)
        if (span) intervals.push({ ...span, support })
      }
      const axis = edge.start.x === edge.end.x ? 'y' : 'x'
      const from = Math.min(edge.start[axis], edge.end[axis])
      const to = Math.max(edge.start[axis], edge.end[axis])
      let covered = from
      const proofs: BoundarySupport[] = []
      intervals.sort((a, b) => a.from - b.from || b.to - a.to)
      for (const interval of intervals) {
        if (interval.from > covered) break
        if (interval.to <= covered) continue
        covered = interval.to
        proofs.push(interval.support)
        if (covered === to) return proofs
      }
      return null
    }
    const runs = [...loops.candidates, ...(loops.conflictedCandidates ?? [])].filter(
      (run) => run.edges.length >= 6,
    )
    const closureMatches = new Map<string, { run: NativeClosedStrokeRun; colors: string[] }>()
    const frameMatches = new Map<
      string,
      { frame: (typeof frames.candidates)[number]; colors: string[] }
    >()
    for (const group of groups.values()) {
      if (group.primitives.length > 1000) return finish('paint-primitive-limit')
      for (const run of runs) {
        spend()
        const bounds = boundsOf(run.polygon)
        const containsPaint = group.primitives.some((primitive) => {
          spend()
          if (!boundsOverlap(bounds, primitive.bounds)) return false
          spend(run.polygon.length * primitive.polygon.length)
          return exactNativePolygonContains(run.polygon, primitive.polygon) !== false
        })
        if (containsPaint) continue
        const contacts: NativePageSegment[] = []
        const paintOperations = new Set<number>()
        for (const edge of run.edges) {
          for (const support of group.supports) {
            spend()
            if (!sharedSpan(edge, support.edge)) continue
            contacts.push(edge)
            paintOperations.add(support.edge.operationIndex)
          }
        }
        const opposed = contacts.some((first) =>
          contacts.some((second) => {
            spend()
            if (exactNativeDirectionsParallel(first, second) !== true) return false
            const side = exactNativeOrientation(first.start, first.end, second.start)
            if (side === null || side === 0) return false
            const axis = first.start.x === first.end.x ? 'y' : 'x'
            return (
              Math.sign(first.end[axis] - first.start[axis]) ===
              -Math.sign(second.end[axis] - second.start[axis])
            )
          }),
        )
        if (!opposed || paintOperations.size < 2) continue
        const match = closureMatches.get(run.id) ?? { run, colors: [] }
        match.colors.push(group.color)
        closureMatches.set(run.id, match)
      }
      for (const frame of frames.candidates) {
        if (!frame.jambs.every((jamb) => cover(jamb.frameEdge, group.supports) !== null)) continue
        const match = frameMatches.get(frame.id) ?? { frame, colors: [] }
        match.colors.push(group.color)
        frameMatches.set(frame.id, match)
      }
    }
    for (const { run, colors } of closureMatches.values()) {
      closures.push({
        id: run.id,
        polygon: run.polygon,
        paintColors: colors,
        sourceKind: run.sourceKind,
        remainingSegments: run.remainingSegments,
      })
    }
    for (const { frame, colors } of frameMatches.values()) {
      thresholds.push({
        id: frame.id,
        frameId: frame.id,
        polygon: pathEdges(frame.frame).map((edge) => edge.start),
        paintColors: colors,
      })
    }

    const sourceSegments = nativePageSegments(input.work)
    for (const group of groups.values()) {
      const supports = [...group.supports]
      const polygons = group.primitives.map((primitive) => clippingPolygon(primitive.polygon))
      for (const { run, colors } of closureMatches.values()) {
        if (colors.length !== 1 || colors[0] !== group.color) continue
        polygons.push(clippingPolygon(run.polygon))
        supports.push(
          ...run.edges.map((edge) => ({ kind: 'profile-side' as const, id: run.id, edge })),
        )
      }
      for (const { frame, colors } of frameMatches.values()) {
        if (colors.length !== 1 || colors[0] !== group.color) continue
        polygons.push(clippingPolygon(pathEdges(frame.frame).map((edge) => edge.start)))
        supports.push(
          ...pathEdges(frame.frame).map((edge) => ({
            kind: 'frame-side' as const,
            id: frame.id,
            edge,
          })),
        )
      }
      // Boolean output is only a proposal. Every emitted boundary must be re-proved
      // against the selected literal source edges below, with no rounding or epsilon.
      if (polygons.reduce((sum, polygon) => sum + (polygon[0]?.length ?? 0), 0) > 5000)
        return finish('cavity-boolean-input-limit')
      const union = polygons.length
        ? polygonClipping.union(polygons[0] as Polygon, ...polygons.slice(1))
        : []
      const rings = union.flatMap((component, componentIndex) =>
        component.slice(1).map((ring) => ({ ring, componentIndex })),
      )
      if (rings.length > MAX_CAVITIES) return finish('floor-cavity-count-limit')
      for (const { ring, componentIndex } of rings) {
        spend()
        const polygon = ring.slice(0, -1).map(([x, y]) => ({ x: x as number, y: y as number }))
        const hold = (reason: string) => {
          unprovedCavityCount++
          unprovedCavities.push({
            polygon: polygon.length <= 100 ? polygon : null,
            bounds: boundsOf(polygon),
            vertexCount: polygon.length,
            reason,
          })
        }
        if (polygon.length > 100 || !pdfPolygonIsValid(polygon)) {
          hold('unsupported-cavity-polygon')
          continue
        }
        const nestedIsland = union.some((component, index) => {
          if (index === componentIndex) return false
          const outer = component[0]
          if (!outer) return true
          const island = outer.slice(0, -1).map(([x, y]) => ({ x: x as number, y: y as number }))
          spend(polygon.length * island.length)
          return exactNativePolygonsOverlap(polygon, island) !== false
        })
        if (nestedIsland) {
          hold('nested-painted-island')
          continue
        }
        if (
          unresolvedPaint.some((paint) => {
            spend()
            return (
              (paint.color === null || paint.color === group.color) &&
              boundsOverlap(boundsOf(polygon), paint.bounds)
            )
          })
        ) {
          hold('unresolved-paint-topology')
          continue
        }
        const boundaries: NativeFloorCavity['boundaries'] = []
        for (const [index, start] of polygon.entries()) {
          const end = polygon[(index + 1) % polygon.length] as PagePoint
          const proof = cover({ start, end }, supports)
          if (!proof) break
          boundaries.push({ start, end, supports: proof })
        }
        if (boundaries.length !== polygon.length) {
          hold('boundary-source-gap')
          continue
        }
        const markerLabelIds = circles.cues
          .filter((cue) => {
            const points = [
              numberCircleLoop(cue).start,
              ...numberCircleLoop(cue).segments.flatMap((segment) =>
                segment.kind === 'cubic'
                  ? [segment.control1, segment.control2, segment.end]
                  : segment.kind === 'quadratic'
                    ? [segment.control, segment.end]
                    : [segment.end],
              ),
            ]
            const box = boundsOf(points)
            const corners = [
              { x: box.left, y: box.top },
              { x: box.right, y: box.top },
              { x: box.right, y: box.bottom },
              { x: box.left, y: box.bottom },
            ]
            spend(polygon.length * 8)
            return (
              exactNativePolygonContains(polygon, corners) === true &&
              !boundaries.some((edge) =>
                corners.some(
                  (start, i) =>
                    exactNativeSegmentsTouch(edge, {
                      start,
                      end: corners[(i + 1) % 4] as PagePoint,
                    }) !== false,
                ),
              )
            )
          })
          .map((cue) => cue.labelId)
        const usedSources = new Set(
          boundaries.flatMap((edge) => edge.supports.map((support) => refKey(support.edge))),
        )
        const box = boundsOf(polygon)
        let unknownInteriorStrokeCount = 0
        for (const edge of sourceSegments) {
          if (
            usedSources.has(refKey(edge)) ||
            !boundsOverlap(box, boundsOf([edge.start, edge.end]))
          )
            continue
          spend(polygon.length * polygon.length)
          if (exactNativeSegmentCrossesPolygonInterior(edge, polygon) !== false)
            unknownInteriorStrokeCount++
        }
        const omittedBoundaryInkCount = omissions.filter((omission) => {
          spend()
          return (
            boundsOverlap(box, omission.bounds) &&
            boundaries.some((edge) =>
              boundsOverlap(boundsOf([edge.start, edge.end]), omission.bounds),
            )
          )
        }).length
        cavities.push({
          id: `native-floor-cavity-${cavities.length + 1}`,
          polygon,
          boundaries,
          paintColor: group.color,
          markerLabelIds,
          markerStatus:
            circles.status === 'unresolved'
              ? 'unavailable'
              : markerLabelIds.length
                ? 'unambiguous'
                : 'unmarked',
          closureIds: [
            ...new Set(
              boundaries.flatMap((edge) =>
                edge.supports
                  .filter((support) => support.kind !== 'paint-boundary')
                  .map((support) => support.id),
              ),
            ),
          ],
          unknownInteriorStrokeCount,
          omittedBoundaryInkCount,
        })
        if (cavities.length > MAX_CAVITIES) return finish('floor-cavity-count-limit')
        if (cavities.reduce((sum, cell) => sum + cell.polygon.length, 0) > 4000)
          return finish('floor-cavity-output-limit')
      }
    }
    const leaders = nativeFloorMarkerLeaders(input.work, circles.cues, cavities)
    if (leaders.refusalReason) return finish(leaders.refusalReason)
    markerLeaders = leaders.bindings
    markerLeaderIssues = leaders.issues
    for (const binding of markerLeaders) {
      const cell = cavities.find((candidate) => candidate.id === binding.cavityId)
      if (!cell) return finish('floor-marker-leader-target-unavailable')
      cell.markerLabelIds.push(binding.labelId)
      cell.markerStatus = 'unambiguous'
    }
    // Competing source cells/numbers stay ambiguous; never choose a nearest/smallest floor.
    for (const cell of cavities) {
      const numbers = circles.cues
        .filter((cue) => cell.markerLabelIds.includes(cue.labelId))
        .map((cue) => cue.sourceNumber)
      if (
        numbers.some(
          (number) => circles.cues.filter((cue) => cue.sourceNumber === number).length !== 1,
        ) ||
        cell.markerLabelIds.some(
          (id) => cavities.filter((other) => other.markerLabelIds.includes(id)).length !== 1,
        )
      )
        cell.markerStatus = 'ambiguous'
    }
    return finish(null)
  } catch (error) {
    if (error === exhausted) return finish('floor-cavity-work-limit')
    return finish('paint-cavity-boolean-unresolved')
  }
}
