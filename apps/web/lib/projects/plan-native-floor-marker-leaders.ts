import { exactMonotoneCubicLoopLocation } from './plan-native-cubic-location'
import { exactNativePointLocation } from './plan-native-exact-intersections'
import {
  type nativeNumberCircleCandidates,
  numberCircleLoop,
  numberCircleSourcePaths,
} from './plan-native-number-circles'
import type { Bounds, PagePoint, PdfLinework } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

type Cue = ReturnType<typeof nativeNumberCircleCandidates>['cues'][number]
type Cell = { id: string; polygon: PagePoint[]; markerLabelIds: string[] }
export type NativeFloorMarkerLeader = {
  labelId: string
  cavityId: string
  segment: NativePageSegment
  circleEndpoint: 'start' | 'end'
  proof: NonNullable<ReturnType<typeof exactMonotoneCubicLoopLocation>['proof']>
}
const MAX_WORK = 500_000

/** Annotation links only. A leader is not a passage, wall edge or floor boundary. */
export function nativeFloorMarkerLeaders(work: PdfLinework, cues: Cue[], cells: Cell[]) {
  const bindings: NativeFloorMarkerLeader[] = []
  const issues: { labelId: string; reason: string }[] = []
  const finish = (refusalReason: string | null) => ({
    bindings: refusalReason ? [] : structuredClone(bindings),
    issues: refusalReason ? [] : issues,
    refusalReason,
  })
  if (work.paths.length > 5000 || cues.length > 100 || cells.length > 100)
    return finish('floor-marker-leader-input-limit')
  const controlBounds = new Map<Cue, Bounds>()
  for (const cue of cues) {
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
    // The circle recognizer's fitted anchor bounds can exclude a source handle.
    // Broad-phase exclusion must use the whole original control hull instead.
    controlBounds.set(cue, {
      left: Math.min(...points.map(({ x }) => x)),
      right: Math.max(...points.map(({ x }) => x)),
      top: Math.min(...points.map(({ y }) => y)),
      bottom: Math.max(...points.map(({ y }) => y)),
    })
  }
  const omittedOps = new Set([
    ...(work.skippedCurveBounds ?? []).map(({ operationIndex }) => operationIndex),
    ...(work.clippedPathBounds ?? []).map(({ operationIndex }) => operationIndex),
    ...(work.curvePaths ?? []).map(({ operationIndex }) => operationIndex),
  ])
  const operationCounts = new Map<number, number>()
  for (const path of work.paths)
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
  const eligible = work.paths.filter(
    (path) =>
      path.paint === 'stroke' &&
      !path.closed &&
      path.points.length === 2 &&
      operationCounts.get(path.operationIndex) === 1 &&
      !omittedOps.has(path.operationIndex) &&
      Number.isSafeInteger(path.operationIndex) &&
      path.operationIndex >= 0 &&
      Number.isSafeInteger(path.subpathIndex) &&
      path.subpathIndex >= 0,
  )
  const segments: NativePageSegment[] = eligible.map((path) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex: 0,
    start: path.points[0] as PagePoint,
    end: path.points[1] as PagePoint,
  }))
  const eligiblePaths = new Set(eligible)
  const unsupportedEndpoints = [
    ...work.paths
      .filter(
        (path) =>
          !eligiblePaths.has(path) &&
          !path.closed &&
          path.paint !== 'fill' &&
          path.points.length >= 2,
      )
      .map((path) => ({
        sourcePath: path,
        start: path.points[0] as PagePoint,
        end: path.points.at(-1) as PagePoint,
      })),
    ...(work.curvePaths ?? [])
      .filter((curve) => !curve.closed && curve.paint !== 'fill' && curve.segments.length)
      .map((curve) => ({
        sourcePath: curve,
        start: curve.start,
        end: curve.segments.at(-1)?.end as PagePoint,
      })),
  ]
  let remainingWork = MAX_WORK
  const locate = (
    cue: Cue,
    point: PagePoint,
  ): ReturnType<typeof exactMonotoneCubicLoopLocation> => {
    // Reserve the four quarters' maximum bisection work before starting exact
    // BigInt evaluation. Boundary-heavy inputs cannot multiply an uncharged loop.
    remainingWork -= 512
    if (remainingWork < 0) return { location: 'unresolved' as const }
    return exactMonotoneCubicLoopLocation(numberCircleSourcePaths(cue), point)
  }
  for (const cue of cues) {
    const bounds = controlBounds.get(cue) as Bounds
    // This stage handles wholly outboard circles only. It never replaces an
    // existing control-hull containment, or resolves a circle touching a cell.
    if (cells.some((cell) => cell.markerLabelIds.includes(cue.labelId))) continue
    if (
      cells.some((cell) => {
        const xs = cell.polygon.map(({ x }) => x)
        const ys = cell.polygon.map(({ y }) => y)
        return (
          bounds.left <= Math.max(...xs) &&
          bounds.right >= Math.min(...xs) &&
          bounds.top <= Math.max(...ys) &&
          bounds.bottom >= Math.min(...ys)
        )
      })
    )
      continue
    const matches: NativeFloorMarkerLeader[] = []
    const inCueBounds = (point: PagePoint) =>
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    // Unsupported open/curved/compound strokes remain competing evidence, not
    // proof of absence. Do not publish the sole straight leader after filtering
    // away a bent leader attached to the same circle.
    let blocked = (work.clippedPathBounds ?? []).some(
      ({ bounds: clip }) =>
        clip.left <= bounds.right &&
        clip.right >= bounds.left &&
        clip.top <= bounds.bottom &&
        clip.bottom >= bounds.top,
    )
    for (const endpoints of unsupportedEndpoints) {
      if (--remainingWork < 0) return finish('floor-marker-leader-work-limit')
      // Open semicircles forming this cue are its boundary, not competing
      // annotation leaders. Other subpaths, including siblings, still compete.
      if (
        numberCircleSourcePaths(cue).some(
          (path) =>
            path.operationIndex === endpoints.sourcePath.operationIndex &&
            path.subpathIndex === endpoints.sourcePath.subpathIndex,
        )
      )
        continue
      for (const endpoint of ['start', 'end'] as const) {
        const point = endpoints[endpoint]
        if (!inCueBounds(point) || locate(cue, point).location === 'outside') continue
        const other = endpoints[endpoint === 'start' ? 'end' : 'start']
        if (locate(cue, other).location !== 'inside') blocked = true
      }
    }
    for (const segment of segments) {
      if (--remainingWork < 0) return finish('floor-marker-leader-work-limit')
      if (segment.start.x === segment.end.x && segment.start.y === segment.end.y) continue
      for (const circleEndpoint of ['start', 'end'] as const) {
        const point = segment[circleEndpoint]
        if (!inCueBounds(point)) continue
        const location = locate(cue, point)
        if (location.location === 'outside') continue
        if (location.location !== 'inside' || !location.proof) {
          blocked = true
          continue
        }
        const other = segment[circleEndpoint === 'start' ? 'end' : 'start']
        const ownOther = locate(cue, other)
        if (ownOther.location !== 'outside') {
          // A line wholly in the circle is a symbol stroke, not a room leader.
          if (ownOther.location !== 'inside') blocked = true
          continue
        }
        let competingCircle = false
        for (const competitor of cues) {
          if (competitor.labelId === cue.labelId) continue
          const otherBounds = controlBounds.get(competitor) as Bounds
          if (--remainingWork < 0) return finish('floor-marker-leader-work-limit')
          if (
            [point, other].some(
              (endpoint) =>
                endpoint.x >= otherBounds.left &&
                endpoint.x <= otherBounds.right &&
                endpoint.y >= otherBounds.top &&
                endpoint.y <= otherBounds.bottom &&
                locate(competitor, endpoint).location !== 'outside',
            )
          )
            competingCircle = true
        }
        if (competingCircle) {
          blocked = true
          continue
        }
        const targets: Cell[] = []
        for (const cell of cells) {
          remainingWork -= cell.polygon.length
          if (remainingWork < 0) return finish('floor-marker-leader-work-limit')
          const target = exactNativePointLocation(cell.polygon, other)
          if (target === 'inside') targets.push(cell)
          if (target === 'boundary' || target === 'unresolved') blocked = true
        }
        if (targets.length !== 1) {
          blocked = true
          continue
        }
        matches.push({
          labelId: cue.labelId,
          cavityId: (targets[0] as Cell).id,
          segment,
          circleEndpoint,
          proof: location.proof,
        })
      }
    }
    if (remainingWork < 0) return finish('floor-marker-leader-work-limit')
    if (blocked || matches.length > 1) {
      issues.push({ labelId: cue.labelId, reason: 'competing-or-unproved-source-leaders' })
    } else if (matches.length === 1) {
      bindings.push(matches[0] as NativeFloorMarkerLeader)
    }
  }
  return finish(null)
}
