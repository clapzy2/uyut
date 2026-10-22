import type { PlanPageSegmentRef } from '@uyut/db'
import {
  exactNativeOrientation,
  exactNativePointKey,
  exactNativePolygonContains,
  exactNativeSegmentsTouch,
} from './plan-native-exact-intersections'
import type { Bounds, PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

type PathRef = { operationIndex: number; subpathIndex: number }
type Segment = { ref: PlanPageSegmentRef; start: PagePoint; end: PagePoint; path: PdfVectorPath }
export type NativeHeightLeaderResult = {
  status: 'candidate' | 'ambiguous' | 'unresolved'
  reason: string | null
  proof?: {
    boxRefs: PathRef[]
    stemRefs: PlanPageSegmentRef[]
    arrowRef: PathRef
    arrowPolygon: PagePoint[]
    tip: PagePoint
  }
}
const MAX_WORK = 500_000
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing validated height-leader item')
  return value
}
const same = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const pathRef = (path: PdfVectorPath): PathRef => ({
  operationIndex: path.operationIndex,
  subpathIndex: path.subpathIndex,
})
const pointValid = (point: PagePoint) => !!point && exactNativePointKey(point) !== null
const onSegment = (point: PagePoint, start: PagePoint, end: PagePoint) =>
  exactNativeOrientation(start, end, point) === 0 &&
  point.x >= Math.min(start.x, end.x) &&
  point.x <= Math.max(start.x, end.x) &&
  point.y >= Math.min(start.y, end.y) &&
  point.y <= Math.max(start.y, end.y)
const literalPolygon = (path: PdfVectorPath, count: number) => {
  const points = path.points
  if (!path.closed || (points.length !== count && points.length !== count + 1)) return null
  if (points.length === count + 1 && !same(required(points[0]), required(points[count])))
    return null
  const polygon = points.slice(0, count)
  if (new Set(polygon.map(exactNativePointKey)).size !== count) return null
  return polygon
}
function rectangle(work: PdfLinework, path: PdfVectorPath) {
  if (path.paint !== 'stroke') return null
  const polygon = literalPolygon(path, 4)
  if (!polygon) return null
  const xs = new Set(polygon.map((point) => point.x))
  const ys = new Set(polygon.map((point) => point.y))
  if (xs.size !== 2 || ys.size !== 2) return null
  // Source callout-shape scope, not an endpoint or containment tolerance.
  // Sheet frames and floor rectangles remain in the competing-stroke graph.
  const width = ((Math.max(...xs) - Math.min(...xs)) * work.pageWidth) / 1000
  const height = ((Math.max(...ys) - Math.min(...ys)) * work.pageHeight) / 1000
  if (width < 20 || width > 200 || height < 5 || height > 45) return null
  for (let index = 0; index < 4; index++) {
    const a = required(polygon[index])
    const b = required(polygon[(index + 1) % 4])
    if ((a.x === b.x) === (a.y === b.y)) return null
  }
  return polygon
}
function triangle(work: PdfLinework, path: PdfVectorPath) {
  if (path.paint === 'stroke') return null
  const polygon = literalPolygon(path, 3)
  if (
    !polygon ||
    exactNativeOrientation(required(polygon[0]), required(polygon[1]), required(polygon[2])) === 0
  )
    return null
  const physical = (point: PagePoint) => ({
    x: (point.x * work.pageWidth) / 1000,
    y: (point.y * work.pageHeight) / 1000,
  })
  const tips: { tip: PagePoint; base: [PagePoint, PagePoint] }[] = []
  for (let index = 0; index < 3; index++) {
    const tip = required(polygon[index])
    const a = required(polygon[(index + 1) % 3])
    const b = required(polygon[(index + 2) % 3])
    const pa = physical(a)
    const pb = physical(b)
    const pt = physical(tip)
    const dx = pt.x - (pa.x + pb.x) / 2
    const dy = pt.y - (pa.y + pb.y) / 2
    const width = Math.hypot(pa.x - pb.x, pa.y - pb.y)
    const length = Math.hypot(dx, dy)
    const skew = Math.abs(dx * (pa.x - pb.x) + dy * (pa.y - pb.y)) / (length * width)
    if (
      width >= 0.2 &&
      width <= 4 &&
      length >= 1 &&
      length <= 10 &&
      length / width >= 2.5 &&
      length / width <= 12 &&
      skew <= 0.15
    )
      tips.push({ tip, base: [a, b] })
  }
  return tips.length === 1 ? { ...required(tips[0]), polygon } : null
}

/** Exact source callout topology only. A candidate never assigns a room or a height. */
export function createNativeHeightLeaderVerifier(work: PdfLinework) {
  let spent = 0
  let refusal: string | null = null
  const charge = (amount = 1) => {
    spent += amount
    if (spent > MAX_WORK) refusal = 'height-leader-work-limit'
    return !refusal
  }
  const fail = (
    reason: string,
    status: 'unresolved' | 'ambiguous' = 'unresolved',
  ): NativeHeightLeaderResult => ({ status, reason })
  if (
    !Array.isArray(work.paths) ||
    (work.skippedCurveBounds !== undefined && !Array.isArray(work.skippedCurveBounds)) ||
    (work.clippedPathBounds !== undefined && !Array.isArray(work.clippedPathBounds)) ||
    (work.curvePaths !== undefined && !Array.isArray(work.curvePaths))
  )
    return (_quad: readonly PagePoint[]) => fail('invalid-height-leader-source')
  if (
    work.paths.length > 5000 ||
    (work.skippedCurveBounds ?? []).length > 5000 ||
    (work.clippedPathBounds ?? []).length > 5000 ||
    (work.curvePaths ?? []).length > 5000
  )
    return (_quad: readonly PagePoint[]) => fail('height-leader-source-limit')
  const paths = Array.isArray(work.paths) ? work.paths : []
  const segments: Segment[] = []
  const segmentsByPath = new Map<PdfVectorPath, Segment[]>()
  const boxes: { path: PdfVectorPath; polygon: PagePoint[] }[] = []
  const arrows: { path: PdfVectorPath; shape: NonNullable<ReturnType<typeof triangle>> }[] = []
  const omissions = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    work.coordinateSystem !== 'page-0-1000' ||
    !Number.isFinite(work.pageWidth) ||
    work.pageWidth <= 0 ||
    !Number.isFinite(work.pageHeight) ||
    work.pageHeight <= 0 ||
    paths.length > 5000 ||
    work.truncated ||
    work.unsupportedPaths ||
    work.unsupportedContexts ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated ||
    work.curvePathsTruncated ||
    omissions.length > 5000 ||
    ![work.skippedCurves, work.clippedPaths].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    (work.skippedCurveBounds ?? []).length !== work.skippedCurves ||
    (work.clippedPathBounds ?? []).length !== work.clippedPaths
  )
    refusal = 'height-leader-source-incomplete'
  let pointCount = 0
  const identities = new Set<string>()
  const operationCounts = new Map<number, number>()
  for (const path of paths) {
    if (!charge()) break
    if (
      !path ||
      !Number.isSafeInteger(path.operationIndex) ||
      path.operationIndex < 0 ||
      !Number.isSafeInteger(path.subpathIndex) ||
      path.subpathIndex < 0 ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint) ||
      typeof path.closed !== 'boolean' ||
      !Array.isArray(path.points) ||
      path.points.length < 2 ||
      path.points.length > 20_000 ||
      pointCount + path.points.length > 20_000 ||
      path.points.some((point) => !pointValid(point)) ||
      identities.has(`${path.operationIndex}:${path.subpathIndex}`)
    ) {
      refusal = 'invalid-height-leader-source'
      break
    }
    identities.add(`${path.operationIndex}:${path.subpathIndex}`)
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
    pointCount += path.points.length
    if (pointCount > 20_000) {
      refusal = 'height-leader-source-limit'
      break
    }
    const box = rectangle(work, path)
    if (box) boxes.push({ path, polygon: box })
    const arrow = triangle(work, path)
    if (arrow) arrows.push({ path, shape: arrow })
    const vertices = [...path.points]
    const ownSegments: Segment[] = []
    if (path.closed && !same(required(vertices[0]), required(vertices.at(-1))))
      vertices.push(required(vertices[0]))
    for (let index = 1; index < vertices.length; index++) {
      const start = required(vertices[index - 1])
      const end = required(vertices[index])
      if (same(start, end)) continue
      const segment = { path, start, end, ref: { ...pathRef(path), segmentIndex: index - 1 } }
      segments.push(segment)
      ownSegments.push(segment)
    }
    segmentsByPath.set(path, ownSegments)
  }
  for (const omitted of omissions) {
    const b = omitted?.bounds
    if (
      !Number.isSafeInteger(omitted?.operationIndex) ||
      omitted.operationIndex < 0 ||
      !b ||
      ![b.left, b.top, b.right, b.bottom].every(Number.isFinite) ||
      b.left > b.right ||
      b.top > b.bottom
    )
      refusal = 'invalid-height-leader-omission'
  }
  if (refusal) return (_quad: readonly PagePoint[]) => fail(required(refusal ?? undefined))
  if ((work.curvePaths ?? []).length + paths.length > 5000) refusal = 'height-leader-source-limit'
  for (const curve of work.curvePaths ?? []) {
    if (refusal) break
    if (
      !curve ||
      !Array.isArray(curve.segments) ||
      curve.segments.length > 20_000 ||
      !omissions.some((row) => row.operationIndex === curve.operationIndex)
    ) {
      refusal = 'invalid-height-leader-source'
      break
    }
    const points = [curve.start]
    for (const segment of curve.segments) {
      if (!segment || !['line', 'quadratic', 'cubic'].includes(segment.kind)) {
        refusal = 'invalid-height-leader-source'
        break
      }
      points.push(segment.end)
      if (segment.kind === 'quadratic') points.push(segment.control)
      if (segment.kind === 'cubic') points.push(segment.control1, segment.control2)
    }
    pointCount += points.length
    if (pointCount > 20_000) refusal = 'height-leader-source-limit'
    if (points.some((point) => !pointValid(point))) refusal = 'invalid-height-leader-source'
  }
  const compound = (path: PdfVectorPath) =>
    operationCounts.get(path.operationIndex) !== 1 ||
    omissions.some((row) => row.operationIndex === path.operationIndex)
  const boundsPolygon = (b: Bounds) => [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: b.bottom },
    { x: b.left, y: b.bottom },
  ]
  const omissionTouches = (start: PagePoint, end: PagePoint) => {
    for (const row of omissions) {
      if (!charge(4)) return true
      const b = row.bounds
      if (
        Math.max(start.x, end.x) < b.left ||
        Math.min(start.x, end.x) > b.right ||
        Math.max(start.y, end.y) < b.top ||
        Math.min(start.y, end.y) > b.bottom
      )
        continue
      if (
        [start, end].some((p) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom)
      )
        return true
      // Omitted ink may extend beyond the page. If its envelope reaches this
      // segment, unsupported off-page coordinates must remain a blocker.
      if ([b.left, b.top, b.right, b.bottom].some((value) => value < 0 || value > 1000)) return true
      const polygon = boundsPolygon(b)
      if (
        polygon.some(
          (a, index) =>
            exactNativeSegmentsTouch(
              { start, end },
              {
                start: a,
                end: required(polygon[(index + 1) % 4]),
              },
            ) !== false,
        )
      )
        return true
    }
    return false
  }
  return (quad: readonly PagePoint[]): NativeHeightLeaderResult => {
    if (refusal) return fail(refusal)
    if (
      !Array.isArray(quad) ||
      quad.length !== 4 ||
      quad.some((point) => !pointValid(point)) ||
      exactNativePolygonContains(quad, quad) !== true
    )
      return fail('invalid-height-leader-quad')
    const containing: typeof boxes = []
    for (const box of boxes) {
      if (!charge(16)) return fail(refusal ?? 'height-leader-work-limit')
      const contact = box.polygon.some((start, index) =>
        quad.some(
          (other, otherIndex) =>
            exactNativeSegmentsTouch(
              { start, end: required(box.polygon[(index + 1) % 4]) },
              { start: other, end: required(quad[(otherIndex + 1) % 4]) },
            ) !== false,
        ),
      )
      if (contact || exactNativePolygonContains(quad, box.polygon) === true)
        return fail('height-leader-caption-box-contact', 'ambiguous')
      if (exactNativePolygonContains(box.polygon, quad) === true) containing.push(box)
    }
    if (containing.length !== 1)
      return fail(
        containing.length ? 'competing-height-leader-boxes' : 'height-leader-box-unresolved',
        containing.length ? 'ambiguous' : 'unresolved',
      )
    const box = required(containing[0])
    if (compound(box.path)) return fail('unsupported-height-leader-compound')
    const boxEdges = segments.filter((segment) => segment.path === box.path)
    const boxXs = box.polygon.map((point) => point.x)
    const boxYs = box.polygon.map((point) => point.y)
    for (const row of omissions) {
      if (!charge()) return fail(refusal ?? 'height-leader-work-limit')
      if (
        row.bounds.left <= Math.max(...boxXs) &&
        row.bounds.right >= Math.min(...boxXs) &&
        row.bounds.top <= Math.max(...boxYs) &&
        row.bounds.bottom >= Math.min(...boxYs)
      )
        return fail('height-leader-omitted-ink')
    }
    const entries: { segment: Segment; at: PagePoint; next: PagePoint }[] = []
    for (const segment of segments) {
      if (!charge(8)) return fail(refusal ?? 'height-leader-work-limit')
      if (segment.path === box.path) continue
      for (const [at, next] of [
        [segment.start, segment.end],
        [segment.end, segment.start],
      ]) {
        if (boxEdges.some((edge) => onSegment(required(at), edge.start, edge.end)))
          entries.push({ segment, at: required(at), next: required(next) })
      }
    }
    if (entries.length !== 1)
      return fail(
        entries.length ? 'competing-height-leader-stems' : 'height-leader-stem-unresolved',
        entries.length ? 'ambiguous' : 'unresolved',
      )
    let current = required(entries[0]).at
    let next = required(entries[0]).next
    let segment = required(entries[0]).segment
    const walked: Segment[] = []
    for (let step = 0; step < 8; step++) {
      if (
        segment.path.closed ||
        segment.path.paint !== 'stroke' ||
        walked.includes(segment) ||
        compound(segment.path)
      )
        return fail('unsupported-height-leader-stem')
      if (
        boxEdges.some((edge) => onSegment(next, edge.start, edge.end)) ||
        walked.some((edge) => onSegment(next, edge.start, edge.end))
      )
        return fail('height-leader-cycle', 'ambiguous')
      if (omissionTouches(current, next)) return fail(refusal ?? 'height-leader-omitted-ink')
      walked.push(segment)
      const hits: typeof arrows = []
      for (const arrow of arrows) {
        if (!charge()) return fail(refusal ?? 'height-leader-work-limit')
        const { tip, base } = arrow.shape
        if (!onSegment(next, base[0], base[1])) continue
        if (exactNativeOrientation(current, next, tip) !== 0) continue
        const forward =
          (tip.x - next.x) * (next.x - current.x) + (tip.y - next.y) * (next.y - current.y)
        if (forward > 0) hits.push(arrow)
      }
      if (hits.length > 1) return fail('competing-height-leader-arrows', 'ambiguous')
      // A collinear subdivision inside one source polyline is not a real line
      // end. Its transverse crossing of a closed contour remains a crossing;
      // literal foreign endpoints and open-line interior attachments still hold.
      const ownSegments = segmentsByPath.get(segment.path) ?? []
      if (!charge(ownSegments.length)) return fail(refusal ?? 'height-leader-work-limit')
      const samePathContinuations = ownSegments.filter(
        (other) =>
          other.path === segment.path &&
          !walked.includes(other) &&
          (same(next, other.start) || same(next, other.end)),
      )
      const continuation = samePathContinuations.length === 1 ? samePathContinuations[0] : undefined
      const beyond = continuation
        ? same(next, continuation.start)
          ? continuation.end
          : continuation.start
        : undefined
      const throughSourceVertex =
        !!beyond &&
        exactNativeOrientation(current, next, beyond) === 0 &&
        (beyond.x - next.x) * (next.x - current.x) + (beyond.y - next.y) * (next.y - current.y) > 0
      const continuations: Segment[] = []
      for (const other of segments) {
        if (!charge()) return fail(refusal ?? 'height-leader-work-limit')
        if (walked.includes(other) || other.path === box.path) continue
        if (hits.length === 1 && other.path === required(hits[0]).path) continue
        if (onSegment(next, other.start, other.end)) {
          // Only literal endpoint joins continue. An endpoint meeting an interior
          // is a branch; ordinary interior/interior crossings are not joins.
          if (!same(next, other.start) && !same(next, other.end)) {
            const transverse =
              exactNativeOrientation(current, next, other.start) !== 0 &&
              exactNativeOrientation(current, next, other.end) !== 0
            if (!throughSourceVertex || !other.path.closed || !transverse)
              return fail('height-leader-interior-attachment', 'ambiguous')
          } else {
            continuations.push(other)
          }
        }
        if (
          (!same(other.start, next) && onSegment(other.start, current, next)) ||
          (!same(other.end, next) && onSegment(other.end, current, next))
        )
          return fail('height-leader-branch', 'ambiguous')
      }
      if (hits.length === 1) {
        if (continuations.length) return fail('height-leader-branch', 'ambiguous')
        const arrow = required(hits[0])
        if (compound(arrow.path)) return fail('unsupported-height-leader-compound')
        for (let index = 0; index < 3; index++) {
          if (
            omissionTouches(
              required(arrow.shape.polygon[index]),
              required(arrow.shape.polygon[(index + 1) % 3]),
            )
          )
            return fail(refusal ?? 'height-leader-omitted-ink')
        }
        for (const edge of boxEdges) {
          if (omissionTouches(edge.start, edge.end))
            return fail(refusal ?? 'height-leader-omitted-ink')
        }
        return {
          status: 'candidate',
          reason: null,
          proof: {
            boxRefs: [pathRef(box.path)],
            stemRefs: walked.map((row) => ({ ...row.ref })),
            arrowRef: pathRef(arrow.path),
            arrowPolygon: arrow.shape.polygon.map((p) => ({ ...p })),
            tip: { ...arrow.shape.tip },
          },
        }
      }
      if (continuations.length !== 1)
        return fail(
          continuations.length ? 'height-leader-branch' : 'height-leader-arrow-unresolved',
          continuations.length ? 'ambiguous' : 'unresolved',
        )
      current = next
      segment = required(continuations[0])
      next = same(current, segment.start) ? segment.end : segment.start
    }
    return fail('height-leader-chain-limit')
  }
}
