import type { NativeTextAnchors } from './plan-document'
import {
  exactNativeOrientation,
  exactNativePointKey,
  exactNativePolygonsOverlap,
} from './plan-native-exact-intersections'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { Bounds, PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeFilledPanel = {
  id: string
  body: PdfVectorPath
  caps: [PdfVectorPath, PdfVectorPath]
  shortEdges: [NativePageSegment, NativePageSegment]
  unresolvedInk: { kind: 'curve' | 'clip'; operationIndex: number; bounds: Bounds }[]
  laterPaintOperations: number[]
  laterPaintCount: number
  laterPaintTruncated: boolean
  physicalJambAccepted: false
  physicalPassageAccepted: false
  closesFloorBoundary: false
  finalPaintVisibilityProved: false
}

const MAX_PANELS = 100
const MAX_COMPARISONS = 200_000
const MAX_LATER_PAINT_REFS = 100
const key = (path: PdfVectorPath) => `${path.operationIndex}:${path.subpathIndex}`
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const boundsOverlap = (a: Bounds, b: Bounds) =>
  a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom

type Quad = {
  path: PdfVectorPath
  points: PagePoint[]
  edges: NativePageSegment[]
  lengths: number[]
  bounds: Bounds
}

function convexQuad(path: PdfVectorPath): PagePoint[] | null {
  const first = path.points[0]
  const last = path.points.at(-1)
  const points = first && last && samePoint(first, last) ? path.points.slice(0, -1) : path.points
  if (points.length !== 4) return null
  const turns = points.map((point, index) =>
    exactNativeOrientation(
      point,
      points[(index + 1) % 4] as PagePoint,
      points[(index + 2) % 4] as PagePoint,
    ),
  )
  return turns.every((turn) => turn === 1) || turns.every((turn) => turn === -1) ? points : null
}

function straddles(edge: NativePageSegment, points: PagePoint[]): boolean {
  const sides = points.map((point) => exactNativeOrientation(edge.start, edge.end, point))
  if (!sides.includes(-1) || !sides.includes(1)) return false
  // Crossing the infinite line outside the end is not contact with the actual body end.
  // The midpoint has denominator two: never turn it into an approximate JS source point.
  // Existing source keys are reduced decimal fractions whose denominators divide 10^18.
  const integerPoint = (point: PagePoint) => {
    const sourceKey = exactNativePointKey(point)
    if (!sourceKey) return null
    const coordinates = sourceKey.split(':').map((coordinate) => {
      const [numerator, denominator] = coordinate.split('/').map(BigInt)
      return ((numerator as bigint) * 10n ** 18n) / (denominator as bigint)
    })
    return { x: coordinates[0] as bigint, y: coordinates[1] as bigint }
  }
  const start = integerPoint(edge.start),
    end = integerPoint(edge.end)
  const cap = points.map(integerPoint)
  if (!start || !end || cap.some((point) => point === null)) return false
  const middle = { x: start.x + end.x, y: start.y + end.y }
  const turns = cap.map((point, index) => {
    const a = point,
      b = cap[(index + 1) % cap.length]
    if (!a || !b) return null
    const determinant = (b.x - a.x) * (middle.y - 2n * a.y) - (b.y - a.y) * (middle.x - 2n * a.x)
    return determinant < 0n ? -1 : determinant > 0n ? 1 : 0
  })
  return turns.every((turn) => turn === 1) || turns.every((turn) => turn === -1)
}

/** Full literal edge contact, with convex interiors on opposite sides; no join tolerance. */
function joinsEnd(edge: NativePageSegment, cap: Quad, body: Quad): boolean {
  const same = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
  if (
    !cap.edges.some(
      (side) =>
        (same(side.start, edge.start) && same(side.end, edge.end)) ||
        (same(side.end, edge.start) && same(side.start, edge.end)),
    )
  )
    return false
  const sides = (points: PagePoint[]) =>
    new Set(
      points
        .map((point) => exactNativeOrientation(edge.start, edge.end, point))
        .filter((side) => side !== 0),
    )
  const bodySides = sides(body.points)
  const capSides = sides(cap.points)
  return (
    bodySides.size === 1 &&
    capSides.size === 1 &&
    ((bodySides.has(1) && capSides.has(-1)) || (bodySides.has(-1) && capSides.has(1)))
  )
}

type PanelContactMode = 'overlapping-endcaps' | 'exact-joined-endcaps'
type PanelContactBasis<Mode extends PanelContactMode> = Mode extends 'exact-joined-endcaps'
  ? 'native-filled-quad-and-exact-joined-endcaps'
  : 'native-filled-quad-and-opposed-cap-overlap'

/** Source paint contacts only. A filled profile is not a window, jamb or free passage. */
export function nativeFilledPanelCandidates<
  Mode extends PanelContactMode = 'overlapping-endcaps',
>(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  /** Opt-in diagnostic joined profiles; legacy passage consumers keep overlap-only evidence. */
  contactMode?: Mode
}) {
  const { native, work } = input
  const frame = nativeFillCandidates(input)
  const scale = native.pageNormalizedScale
  const panels: NativeFilledPanel[] = []
  const rejected: { operationIndex: number; subpathIndex: number; reason: string }[] = []
  let rejectedCount = 0
  const reject = (path: PdfVectorPath, reason: string) => {
    rejectedCount++
    if (rejected.length < MAX_PANELS)
      rejected.push({
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        reason,
      })
  }
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    basis: (input.contactMode === 'exact-joined-endcaps'
      ? 'native-filled-quad-and-exact-joined-endcaps'
      : 'native-filled-quad-and-opposed-cap-overlap') as PanelContactBasis<Mode>,
    source: native.source,
    originalPdfSha256: native.originalPdfSha256,
    panels: refusalReason ? [] : structuredClone(panels),
    rejected,
    rejectedCount,
    diagnosticsTruncated: rejectedCount > rejected.length,
    refusalReason,
    completeOpeningInventory: false as const,
    closesFloorBoundary: false as const,
  })
  if (
    frame.refusalReason === 'incomplete-native-layer' ||
    work.curvePathsTruncated ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated ||
    !scale
  )
    return finish('incomplete-native-layer')
  const omissions = [
    ...(work.skippedCurveBounds ?? []).map((item) => ({ ...item, kind: 'curve' as const })),
    ...(work.clippedPathBounds ?? []).map((item) => ({ ...item, kind: 'clip' as const })),
  ]
  if (
    ![work.skippedCurves, work.clippedPaths, work.unsupportedPaths, work.unsupportedContexts].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    (work.skippedCurveBounds?.length ?? 0) !== work.skippedCurves ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths ||
    omissions.length > 6000 ||
    omissions.some(
      ({ operationIndex, bounds }) =>
        !Number.isSafeInteger(operationIndex) ||
        operationIndex < 0 ||
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return finish('invalid-omission-provenance')
  const omittedOperations = new Set(omissions.map((item) => item.operationIndex))
  const refs = new Set<string>()
  const counts = new Map<number, number>()
  for (const path of work.paths) {
    if (
      refs.has(key(path)) ||
      ![path.operationIndex, path.subpathIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      typeof path.closed !== 'boolean' ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint) ||
      path.points.length < 2
    )
      return finish('invalid-native-provenance')
    if (path.points.some((point) => exactNativePointKey(point) === null))
      return finish('unsupported-source-coordinate-precision')
    refs.add(key(path))
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  }
  const quads: Quad[] = []
  for (const path of work.paths) {
    if (
      path.paint === 'stroke' ||
      !path.closed ||
      counts.get(path.operationIndex) !== 1 ||
      omittedOperations.has(path.operationIndex)
    )
      continue
    const points = convexQuad(path)
    if (!points) continue
    const edges = points.map((start, segmentIndex) => ({
      operationIndex: path.operationIndex,
      subpathIndex: path.subpathIndex,
      segmentIndex,
      start,
      end: points[(segmentIndex + 1) % 4] as PagePoint,
    }))
    quads.push({
      path,
      points,
      edges,
      lengths: edges.map((edge) =>
        Math.hypot((edge.end.x - edge.start.x) * scale.x, (edge.end.y - edge.start.y) * scale.y),
      ),
      bounds: {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        bottom: Math.max(...points.map((point) => point.y)),
      },
    })
  }
  let comparisons = 0
  const spend = () => ++comparisons <= MAX_COMPARISONS
  const pending: {
    body: Quad
    caps: [Quad, Quad]
    shortEdges: [NativePageSegment, NativePageSegment]
  }[] = []
  const capOwners = new Map<string, Set<string>>()
  for (const body of quads) {
    const even = Math.max(body.lengths[0] as number, body.lengths[2] as number)
    const odd = Math.max(body.lengths[1] as number, body.lengths[3] as number)
    const shortParity = even < odd ? 0 : 1
    const shortEdges = [body.edges[shortParity], body.edges[shortParity + 2]] as [
      NativePageSegment,
      NativePageSegment,
    ]
    const depth = Math.max(...body.lengths.filter((_, index) => index % 2 === shortParity))
    const length = Math.min(...body.lengths.filter((_, index) => index % 2 !== shortParity))
    // Raster proportions are a bounded symbol filter, never a physical measurement or right angle.
    if (length < 5 || depth <= 0 || depth / length > 0.25) continue
    const caps: [Quad[], Quad[]] = [[], []]
    for (const cap of quads) {
      if (!spend()) return finish('filled-panel-search-budget')
      if (cap === body || !boundsOverlap(body.bounds, cap.bounds)) continue
      if (Math.min(...cap.lengths) < depth / 2 || Math.max(...cap.lengths) > depth * 2) continue
      const joined = input.contactMode === 'exact-joined-endcaps'
      if (!joined && exactNativePolygonsOverlap(body.points, cap.points) !== true) continue
      const ends = shortEdges.map((edge) =>
        joined ? joinsEnd(edge, cap, body) : straddles(edge, cap.points),
      )
      if (ends[0] === ends[1]) continue
      const end = ends[0] ? 0 : 1
      caps[end].push(cap)
      const owners = capOwners.get(key(cap.path)) ?? new Set<string>()
      owners.add(key(body.path))
      capOwners.set(key(cap.path), owners)
    }
    const first = caps[0][0],
      last = caps[1][0]
    if (caps[0].length !== 1 || caps[1].length !== 1 || !first || !last) {
      reject(
        body.path,
        caps.some((items) => items.length > 1)
          ? 'competing-filled-caps'
          : input.contactMode === 'exact-joined-endcaps'
            ? 'no-two-exact-joined-endcaps'
            : 'no-two-opposed-overlapping-caps',
      )
      continue
    }
    if (pending.length === MAX_PANELS) return finish('filled-panel-candidate-limit')
    pending.push({ body, caps: [first, last], shortEdges })
  }
  const pendingBodies = new Set(pending.map((candidate) => key(candidate.body.path)))
  const conflictingRoles = new Set<string>()
  for (const candidate of pending) {
    for (const cap of candidate.caps) {
      if (pendingBodies.has(key(cap.path))) {
        conflictingRoles.add(key(cap.path))
        conflictingRoles.add(key(candidate.body.path))
      }
    }
  }
  for (const candidate of pending) {
    if (conflictingRoles.has(key(candidate.body.path))) {
      reject(candidate.body.path, 'competing-filled-component-roles')
      continue
    }
    if (candidate.caps.some((cap) => (capOwners.get(key(cap.path))?.size ?? 0) > 1)) {
      reject(candidate.body.path, 'competing-filled-bodies')
      continue
    }
    const shapes = [candidate.body, ...candidate.caps]
    const bounds = {
      left: Math.min(...shapes.map((shape) => shape.bounds.left)),
      right: Math.max(...shapes.map((shape) => shape.bounds.right)),
      top: Math.min(...shapes.map((shape) => shape.bounds.top)),
      bottom: Math.max(...shapes.map((shape) => shape.bounds.bottom)),
    }
    const unresolvedInk: NativeFilledPanel['unresolvedInk'] = []
    for (const omission of omissions) {
      if (!spend()) return finish('filled-panel-search-budget')
      if (boundsOverlap(bounds, omission.bounds)) unresolvedInk.push(omission)
    }
    const later = new Set<number>()
    const firstOperation = Math.min(...shapes.map((shape) => shape.path.operationIndex))
    const ownRefs = new Set(shapes.map((shape) => key(shape.path)))
    for (const path of work.paths) {
      if (!spend()) return finish('filled-panel-search-budget')
      if (path.operationIndex <= firstOperation || ownRefs.has(key(path))) continue
      const pathBounds = {
        left: Math.min(...path.points.map((point) => point.x)),
        right: Math.max(...path.points.map((point) => point.x)),
        top: Math.min(...path.points.map((point) => point.y)),
        bottom: Math.max(...path.points.map((point) => point.y)),
      }
      if (boundsOverlap(bounds, pathBounds)) later.add(path.operationIndex)
    }
    panels.push({
      id: `native-filled-panel-${key(candidate.body.path)}`,
      body: candidate.body.path,
      caps: candidate.caps.map((cap) => cap.path) as [PdfVectorPath, PdfVectorPath],
      shortEdges: candidate.shortEdges,
      unresolvedInk,
      laterPaintOperations: [...later].sort((a, b) => a - b).slice(0, MAX_LATER_PAINT_REFS),
      laterPaintCount: later.size,
      laterPaintTruncated: later.size > MAX_LATER_PAINT_REFS,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      finalPaintVisibilityProved: false,
    })
  }
  return finish(null)
}
