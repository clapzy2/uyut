import {
  exactNativePointKey,
  exactNativePolygonContains,
  exactNativePolygonsOverlap,
  exactNativeSegmentsTouch,
} from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import { nativePaintedRegionContext } from './plan-native-painted-region-context'
import { boundedNativeStrokeFaces, type NativeIntersectionProof } from './plan-native-stroke-faces'
import type { Bounds, PagePoint } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'

type Input = Parameters<typeof nativeFillCandidates>[0]
type SourceRef = { operationIndex: number; subpathIndex: number }
type Edge = { start: PagePoint; end: PagePoint; sourceRefs: NativePageSegment[] }
export type NativeVisiblePaintPiece = { polygon: PagePoint[]; holes: PagePoint[][]; edges: Edge[] }
export type NativeVisiblePaintRegion = {
  candidateId: string
  sourceRef: SourceRef
  sourcePolygon: PagePoint[]
  masks: SourceRef[]
  pieces: NativeVisiblePaintPiece[]
  intersections: NativeIntersectionProof[]
  /** Possible omitted strokes at surviving outer/hole boundaries, not interior annotations. */
  omittedStrokeCount: number
  boundaryInkComplete: boolean
  status: 'diagnostic' | 'held'
  refusalReason: string | null
}

// Face vertices can be non-terminating intersections. Use their rational proof,
// not the rounded display coordinate, for point location and partition accounting.
type Fraction = { n: bigint; d: bigint }
type RationalPoint = { x: Fraction; y: Fraction }
function fraction(n: bigint, d = 1n): Fraction {
  if (d < 0n) return fraction(-n, -d)
  let a = n < 0n ? -n : n
  let b = d
  while (b) [a, b] = [b, a % b]
  const divisor = a || 1n
  return { n: n / divisor, d: d / divisor }
}
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d)
const subtract = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d)
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d)
const compare = (a: Fraction, b: Fraction) => {
  const difference = a.n * b.d - b.n * a.d
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}
function pointFromKey(key: string): RationalPoint {
  const [x, y] = key.split(':').map((coordinate) => {
    const [n, d] = coordinate.split('/').map(BigInt)
    return fraction(n as bigint, d as bigint)
  })
  return { x: x as Fraction, y: y as Fraction }
}
function orientation(a: RationalPoint, b: RationalPoint, p: RationalPoint) {
  return subtract(
    multiply(subtract(b.x, a.x), subtract(p.y, a.y)),
    multiply(subtract(b.y, a.y), subtract(p.x, a.x)),
  ).n
}
function location(polygon: RationalPoint[], point: RationalPoint) {
  let winding = 0
  for (const [index, start] of polygon.entries()) {
    const end = polygon[(index + 1) % polygon.length] as RationalPoint
    const turn = orientation(start, end, point)
    const bounded = (axis: 'x' | 'y') =>
      compare(point[axis], start[axis]) * compare(point[axis], end[axis]) <= 0
    if (turn === 0n && bounded('x') && bounded('y')) return 'boundary'
    if (compare(start.y, point.y) <= 0 && compare(end.y, point.y) > 0 && turn > 0n) winding++
    if (compare(start.y, point.y) > 0 && compare(end.y, point.y) <= 0 && turn < 0n) winding--
  }
  return winding ? 'inside' : 'outside'
}
function twiceArea(polygon: RationalPoint[]) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length] as RationalPoint
    return add(sum, subtract(multiply(point.x, next.y), multiply(next.x, point.y)))
  }, fraction(0n))
}
function interiorWitness(polygon: RationalPoint[]) {
  for (const [index, vertex] of polygon.entries()) {
    const previous = polygon[(index + polygon.length - 1) % polygon.length] as RationalPoint
    const next = polygon[(index + 1) % polygon.length] as RationalPoint
    if (orientation(previous, vertex, next) <= 0n) continue
    // A convex corner has a local interior wedge. Search bounded dyadic probes;
    // unsuccessful searches are a refusal, never an approximate acceptance.
    for (let power = 2; power <= 64; power++) {
      const denominator = 1n << BigInt(power)
      const coordinate = (axis: 'x' | 'y') =>
        multiply(
          add(add(previous[axis], next[axis]), multiply(vertex[axis], fraction(denominator - 2n))),
          fraction(1n, denominator),
        )
      const witness = { x: coordinate('x'), y: coordinate('y') }
      if (location(polygon, witness) === 'inside') return witness
    }
  }
  return null
}
function sourceSegments(polygon: PagePoint[], ref: SourceRef): NativePageSegment[] {
  return polygon.map((start, segmentIndex) => ({
    ...ref,
    segmentIndex,
    start,
    end: polygon[(segmentIndex + 1) % polygon.length] as PagePoint,
  }))
}
const bounds = (polygon: PagePoint[]): Bounds => ({
  left: Math.min(...polygon.map((point) => point.x)),
  right: Math.max(...polygon.map((point) => point.x)),
  top: Math.min(...polygon.map((point) => point.y)),
  bottom: Math.max(...polygon.map((point) => point.y)),
})
const boundsTouch = (a: Bounds, b: Bounds) =>
  a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
const ring = (points: PagePoint[]) => {
  const result = points.map((point) => ({ ...point }))
  const first = result[0]
  const last = result.at(-1)
  if (first && last && first.x === last.x && first.y === last.y) result.pop()
  return result
}

/** Later positive paint subtraction, not a free-floor/room or PDF transparency proof.
 * Whole candidates are held when omitted evidence or topology cannot be accounted for.
 */
export function nativeVisiblePaintRegions(input: Input) {
  const regions: NativeVisiblePaintRegion[] = []
  const finish = (refusalReason: string | null) => {
    const pieces = regions.flatMap((region) => region.pieces)
    const pointCount =
      regions.reduce((count, region) => count + region.sourcePolygon.length, 0) +
      pieces.reduce(
        (count, piece) =>
          count + piece.polygon.length + piece.holes.reduce((sum, hole) => sum + hole.length, 0),
        0,
      )
    if (
      !refusalReason &&
      (regions.length > 50 ||
        regions.some((region) => region.pieces.length > 100) ||
        pieces.length > 500 ||
        pointCount > 10_000 ||
        pieces.some(
          (piece) =>
            piece.polygon.length > 100 ||
            piece.holes.length > 50 ||
            piece.holes.some((hole) => hole.length > 100),
        ) ||
        regions.reduce((count, region) => count + region.intersections.length, 0) > 1000)
    )
      refusalReason = 'visible-paint-output-limit'
    return {
      source: { ...input.native.source },
      originalPdfSha256: input.native.originalPdfSha256,
      basis: 'source-decimal-visible-positive-paint' as const,
      status: refusalReason ? ('unresolved' as const) : ('diagnostic' as const),
      refusalReason,
      regions: refusalReason ? [] : regions,
      readOnly: true as const,
      semanticStatus: 'unclassified' as const,
      physicalFloorConfirmed: false as const,
      roomOwnershipConfirmed: false as const,
      readyFor2D: false as const,
      readyFor3D: false as const,
      visibilityConfirmed: false as const,
      boundaryInkComplete: input.work.skippedCurves === 0 && input.work.clippedPaths === 0,
      omissionCounts: {
        skippedCurves: input.work.skippedCurves,
        clippedPaths: input.work.clippedPaths,
      },
    }
  }
  const context = nativePaintedRegionContext(input)
  if (context.refusalReason) return finish(context.refusalReason)
  const inventory = nativeFillCandidates(input)
  const paintEvents = pdfPaintInventoryIsComplete(input.work.paintBounds)
    ? new Map(input.work.paintBounds?.events.map((event) => [event.operationIndex, event]))
    : null
  const counts = new Map<number, number>()
  for (const path of input.work.paths)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  const paint = input.work.paths
    .filter((path) => path.paint !== 'stroke')
    .map((path) => ({
      path,
      polygon: ring(path.points),
    }))
  let budget = 2_000_000
  for (const candidate of inventory.candidates) {
    const region: NativeVisiblePaintRegion = {
      candidateId: candidate.id,
      sourceRef: { ...candidate.sourceRef },
      sourcePolygon: candidate.polygon.map((point) => ({ ...point })),
      masks: [],
      pieces: [],
      intersections: [],
      omittedStrokeCount: 0,
      boundaryInkComplete: true,
      status: 'diagnostic',
      refusalReason: null,
    }
    regions.push(region)
    const hold = (reason: string) => {
      region.status = 'held'
      region.refusalReason = reason
      region.pieces = []
      region.intersections = []
    }
    if (candidate.polygon.some((point) => exactNativePointKey(point) === null)) {
      hold('unsupported-source-decimal-precision')
      continue
    }
    const omissions = [
      ...(input.work.skippedCurveBounds ?? []),
      ...(input.work.clippedPathBounds ?? []),
    ].filter((item) => boundsTouch(bounds(candidate.polygon), item.bounds))
    region.omittedStrokeCount = omissions.filter((item) => item.paint === 'stroke').length
    region.boundaryInkComplete = omissions.length === 0
    if (omissions.some((item) => item.paint !== 'stroke')) {
      hold('omitted-native-evidence-contact')
      continue
    }
    const masks: typeof paint = []
    for (const item of paint) {
      if (item.path.operationIndex <= candidate.sourceRef.operationIndex) continue
      if (!boundsTouch(bounds(candidate.polygon), bounds(item.polygon))) continue
      budget -= candidate.polygon.length * item.polygon.length
      if (budget < 0) return finish('visible-paint-work-limit')
      if (
        !item.path.closed ||
        counts.get(item.path.operationIndex) !== 1 ||
        !pdfPolygonIsValid(item.polygon)
      ) {
        hold('unsupported-later-paint-topology')
        break
      }
      const overlap = exactNativePolygonsOverlap(candidate.polygon, item.polygon)
      if (overlap === null) {
        hold('unresolved-later-paint-contact')
        break
      }
      if (overlap) {
        masks.push(item)
        region.masks.push({
          operationIndex: item.path.operationIndex,
          subpathIndex: item.path.subpathIndex,
        })
      }
    }
    if (region.refusalReason) continue
    const original = paint.find(
      (item) =>
        item.path.operationIndex === candidate.sourceRef.operationIndex &&
        item.path.subpathIndex === candidate.sourceRef.subpathIndex,
    )
    if (!original) {
      hold('missing-original-paint-path')
      continue
    }
    // Candidate polygons are canonical display rings; segment indexes must refer
    // to the original command order, not that reordered display ring.
    const source = sourceSegments(original.polygon, candidate.sourceRef)
    if (!masks.length) {
      region.pieces = [
        {
          polygon: region.sourcePolygon,
          holes: [],
          edges: source.map((segment) => ({
            start: segment.start,
            end: segment.end,
            sourceRefs: [segment],
          })),
        },
      ]
      continue
    }
    if (masks.length > 50) {
      hold('visible-paint-mask-limit')
      continue
    }
    if (masks.some((mask) => exactNativePolygonContains(mask.polygon, candidate.polygon) === true))
      continue
    const maskSegments = masks.map((mask) => sourceSegments(mask.polygon, mask.path))
    const strictlyContained = masks.map(
      (mask, index) =>
        exactNativePolygonContains(candidate.polygon, mask.polygon) === true &&
        !source.some((a) =>
          maskSegments[index]?.some((b) => exactNativeSegmentsTouch(a, b) !== false),
        ),
    )
    // Enclosed rings remain explicit holes, never graph bridges. Their relation
    // to every other mask must be disjoint, including masks cutting the perimeter.
    for (let index = 0; index < masks.length; index++) {
      for (let other = index + 1; other < masks.length; other++) {
        if (!strictlyContained[index] && !strictlyContained[other]) continue
        const first = masks[index] as (typeof masks)[number]
        const second = masks[other] as (typeof masks)[number]
        budget -= 3 * first.polygon.length * second.polygon.length
        if (budget < 0) return finish('visible-paint-work-limit')
        if (
          exactNativePolygonsOverlap(first.polygon, second.polygon) !== false ||
          maskSegments[index]?.some((a) =>
            maskSegments[other]?.some((b) => exactNativeSegmentsTouch(a, b) !== false),
          )
        ) {
          hold('overlapping-or-touching-inner-masks')
          break
        }
      }
      if (region.refusalReason) break
    }
    if (region.refusalReason) continue
    if (strictlyContained.every(Boolean)) {
      region.pieces = [
        {
          polygon: region.sourcePolygon,
          holes: masks.map((mask) => mask.polygon),
          edges: source.map((segment) => ({
            start: segment.start,
            end: segment.end,
            sourceRefs: [segment],
          })),
        },
      ]
      continue
    }
    const crossingMasks = masks.filter((_, index) => !strictlyContained[index])
    const graph = boundedNativeStrokeFaces(
      [...source, ...maskSegments.filter((_, index) => !strictlyContained[index]).flat()],
      0,
      { topology: 'source-decimal-rational' },
    )
    if (graph.refusalReason) {
      hold(graph.refusalReason)
      continue
    }
    const keys = new Map(
      graph.intersections.map((proof) => [
        `${proof.point.x}:${proof.point.y}`,
        proof.exactPointKey,
      ]),
    )
    const rationalRing = (polygon: PagePoint[]) =>
      polygon.map((point) => {
        const key = keys.get(`${point.x}:${point.y}`) ?? exactNativePointKey(point)
        return key ? pointFromKey(key) : null
      })
    const sourceRing = rationalRing(candidate.polygon)
    // Hole paint must not classify a whole face: a face's interior witness may
    // legitimately lie in a hole. Account for holes after the exact partition.
    const maskRings = crossingMasks.map((mask) => rationalRing(mask.polygon))
    if (
      sourceRing.some((point) => !point) ||
      maskRings.some((polygon) => polygon.some((point) => !point))
    ) {
      hold('unsupported-source-decimal-precision')
      continue
    }
    let accountedArea = fraction(0n)
    const retainedFaceKeys: string[][] = []
    for (const face of graph.faces) {
      const faceRing = face.exactPointKeys
        ? face.exactPointKeys.map(pointFromKey)
        : rationalRing(face.polygon)
      if (faceRing.some((point) => !point)) {
        hold('missing-rational-face-proof')
        break
      }
      const witness = interiorWitness(faceRing as RationalPoint[])
      if (!witness) {
        hold('unresolved-face-interior')
        break
      }
      const sourceLocation = location(sourceRing as RationalPoint[], witness)
      const maskLocations = maskRings.map((polygon) =>
        location(polygon as RationalPoint[], witness),
      )
      if (sourceLocation === 'boundary' || maskLocations.includes('boundary')) {
        hold('ambiguous-face-classification')
        break
      }
      if (sourceLocation !== 'inside') continue
      accountedArea = add(accountedArea, twiceArea(faceRing as RationalPoint[]))
      if (maskLocations.every((value) => value === 'outside')) {
        region.pieces.push({ polygon: face.polygon, holes: [], edges: face.edges })
        retainedFaceKeys.push(face.exactPointKeys ?? [])
      }
    }
    if (region.refusalReason) continue
    const expectedArea = twiceArea(sourceRing as RationalPoint[])
    if (compare(accountedArea, expectedArea) !== 0) {
      hold('incomplete-rational-face-partition')
      continue
    }
    const predicates = nativeFaceRationalPredicates()
    for (const [index, mask] of masks.entries()) {
      if (!strictlyContained[index]) continue
      const holeKeys = mask.polygon.map(exactNativePointKey)
      if (holeKeys.some((key) => !key)) {
        hold('unsupported-source-decimal-precision')
        break
      }
      const exactHole = holeKeys as string[]
      const owners: number[] = []
      for (const [pieceIndex, faceKeys] of retainedFaceKeys.entries()) {
        if (!faceKeys.length) {
          hold('missing-rational-face-proof')
          break
        }
        budget -= 2 * exactHole.length * faceKeys.length
        if (budget < 0) return finish('visible-paint-work-limit')
        const inside = exactHole.every((key) => predicates.location(faceKeys, key) === 'inside')
        const touches = exactHole.some((start, edgeIndex) =>
          faceKeys.some((faceStart, faceEdgeIndex) =>
            predicates.segmentsTouch(
              start,
              exactHole[(edgeIndex + 1) % exactHole.length] as string,
              faceStart,
              faceKeys[(faceEdgeIndex + 1) % faceKeys.length] as string,
            ),
          ),
        )
        if (inside && !touches) owners.push(pieceIndex)
      }
      if (region.refusalReason) break
      if (owners.length !== 1) {
        hold('unresolved-inner-mask-face')
        break
      }
      const piece = region.pieces[owners[0] as number] as NativeVisiblePaintPiece
      piece.holes.push(mask.polygon)
    }
    if (region.refusalReason) continue
    region.intersections = graph.intersections
  }
  // Fill partitioning is unchanged. Only now can omission completeness be
  // checked at the actual surviving boundaries, including newly created holes.
  // A path control box never substitutes for a complete stroked-ink envelope.
  const omittedStrokes = [
    ...(input.work.skippedCurveBounds ?? []),
    ...(input.work.clippedPathBounds ?? []),
  ].filter((item) => item.paint !== 'fill')
  for (const region of regions) {
    if (region.status !== 'diagnostic' || !region.pieces.length) continue
    const boundarySpans = region.pieces.flatMap((piece) =>
      [piece.polygon, ...piece.holes].flatMap((polygon) =>
        polygon.map((start, index): [PagePoint, PagePoint] => [
          start,
          polygon[(index + 1) % polygon.length] as PagePoint,
        ]),
      ),
    )
    let possible = 0
    for (const item of omittedStrokes) {
      const event = paintEvents?.get(item.operationIndex)
      if (event?.kind !== 'vector') {
        // Without a full pen envelope even a disjoint centerline/control box
        // cannot bound a thick stroke, cap or join away from this boundary.
        possible++
        continue
      }
      let touches = false
      for (const span of boundarySpans) {
        if (--budget < 0) return finish('visible-paint-work-limit')
        // Display vertices are quantized; this margin excludes paint only and
        // does not assert exact contact, physical ownership or metric accuracy.
        if (pdfPaintMayTouchSpan(event, span, 0.0005)) {
          touches = true
          break
        }
      }
      if (touches) possible++
    }
    region.omittedStrokeCount = possible
    region.boundaryInkComplete = possible === 0
  }
  return finish(null)
}
