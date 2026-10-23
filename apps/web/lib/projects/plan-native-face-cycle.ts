import type { PlanPageSegmentRef, PlanPageVertexProof } from '@uyut/db'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type NativePageSegment,
  nativeEdgeCrossing,
  nativePageSegments,
} from './plan-pdf-opening-endpoint'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'
import { type PdfPlanSource, pdfPolygonIsValid } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

export type ReviewedNativeFaces = {
  review: 'manual-native-face-review'
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  faces: { ref: PlanPageSegmentRef; kind: 'wall-face' | 'reviewed-opening-boundary' }[]
}
const pointKey = (point: PagePoint) => `${point.x}:${point.y}`
const refKey = (ref: PlanPageSegmentRef) =>
  `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const OMISSION_EXCLUSION_POINTS = 0.12

function overlaps(a: NativePageSegment, b: NativePageSegment) {
  const cross = (point: PagePoint) =>
    (a.end.x - a.start.x) * (point.y - a.start.y) - (a.end.y - a.start.y) * (point.x - a.start.x)
  if (Math.abs(cross(b.start)) > 1e-9 || Math.abs(cross(b.end)) > 1e-9) return false
  const axis = Math.abs(a.end.x - a.start.x) >= Math.abs(a.end.y - a.start.y) ? 'x' : 'y'
  return (
    Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis])) >
    Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis]))
  )
}

function corner(a: NativePageSegment, b: NativePageSegment) {
  for (const point of [a.start, a.end]) {
    if ([b.start, b.end].some((other) => samePoint(point, other)))
      return { point: { ...point }, kind: 'native-endpoint' as const }
  }
  const point = nativeEdgeCrossing([a.start, a.end], b)
  return point ? { point, kind: 'bounded-native-crossing' as const } : null
}

/** Order a single reviewed source-face cycle; never extend gaps or classify strokes as walls. */
export function nativeFaceCycle(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  dimensions: ReturnType<typeof nativeDimensionEvidence>
  reviewed: ReviewedNativeFaces
}) {
  const { native, work, reviewed, dimensions } = input
  const fail = (reason: string) => ({ status: 'unresolved' as const, reason, polygon: null })
  for (const source of [input.lineworkSource, reviewed.rasterSource, dimensions.rasterSource])
    bindObservedRegionLabels({
      regionSource: native.source,
      labelSource: source,
      regions: [],
      labels: [],
    })
  if (
    reviewed.review !== 'manual-native-face-review' ||
    !native.complete ||
    !native.originalPdfSha256 ||
    !/^[a-f0-9]{64}$/.test(native.originalPdfSha256) ||
    reviewed.source.sha256 !== native.originalPdfSha256 ||
    reviewed.source.pdfPage !== native.source.page ||
    reviewed.source.state !== 'existing' ||
    dimensions.source.sha256 !== reviewed.source.sha256 ||
    dimensions.source.pdfPage !== reviewed.source.pdfPage ||
    dimensions.source.state !== 'existing' ||
    dimensions.status !== 'draft' ||
    !Array.isArray(dimensions.dimensionOperations) ||
    dimensions.dimensionOperations.length > 160
  )
    throw new Error('Native face review does not match the source')
  if (
    reviewed.faces.length < 3 ||
    reviewed.faces.length > 100 ||
    work.coordinateSystem !== 'page-0-1000' ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0) ||
    work.paths.length > 5000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000 ||
    work.truncated ||
    work.unsupportedPaths ||
    work.unsupportedContexts ||
    !Number.isSafeInteger(work.skippedCurves) ||
    !Number.isSafeInteger(work.clippedPaths) ||
    work.skippedCurves < 0 ||
    work.clippedPaths < 0 ||
    (work.skippedCurveBounds?.length ?? 0) !== work.skippedCurves ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated
  )
    return fail('incomplete-native-boundary-inventory')
  if (work.paintBounds && !pdfPaintInventoryIsComplete(work.paintBounds))
    return fail('incomplete-native-paint-layer')
  const dimensionOperations = new Set(dimensions.dimensionOperations)
  const segments = nativePageSegments(work)
  const selected: (NativePageSegment & { kind: ReviewedNativeFaces['faces'][number]['kind'] })[] =
    []
  const seenRefs = new Set<string>()
  for (const face of reviewed.faces) {
    if (
      !['wall-face', 'reviewed-opening-boundary'].includes(face.kind) ||
      ![face.ref.operationIndex, face.ref.subpathIndex, face.ref.segmentIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      return fail('invalid-reviewed-face-role')
    const key = refKey(face.ref)
    if (seenRefs.has(key)) return fail('reused-native-face')
    seenRefs.add(key)
    if (dimensionOperations.has(face.ref.operationIndex))
      return fail('dimension-operation-is-not-a-floor-face')
    const matches = segments.filter((segment) => refKey(segment) === key)
    const segment = matches[0]
    if (
      matches.length !== 1 ||
      !segment ||
      ![segment.start, segment.end].every((point) =>
        [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000),
      )
    )
      return fail('missing-or-ambiguous-native-face')
    selected.push({ ...segment, kind: face.kind })
  }
  const nodes = new Map<
    string,
    {
      point: PagePoint
      proof: { kind: 'native-endpoint' | 'bounded-native-crossing'; faces: PlanPageSegmentRef[] }
    }
  >()
  const cuts = selected.map(() => new Set<string>())
  for (let first = 0; first < selected.length; first++) {
    const a = selected[first]
    if (!a) return fail('incomplete-selected-faces')
    for (let second = first + 1; second < selected.length; second++) {
      const b = selected[second]
      if (!b) return fail('incomplete-selected-faces')
      if (overlaps(a, b)) return fail('overlapping-native-faces')
      const intersection = corner(a, b)
      if (!intersection) continue
      const key = pointKey(intersection.point)
      if (!nodes.has(key))
        nodes.set(key, {
          ...intersection,
          proof: {
            kind: intersection.kind,
            faces: [reviewed.faces[first]?.ref, reviewed.faces[second]?.ref].filter(
              (ref): ref is PlanPageSegmentRef => ref !== undefined,
            ),
          },
        })
      cuts[first]?.add(key)
      cuts[second]?.add(key)
    }
  }
  const adjacency = new Map<string, number[]>()
  const edgeNodes: [string, string][] = []
  for (const [index, keys] of cuts.entries()) {
    const endpoints = [...keys]
    if (endpoints.length !== 2 || !endpoints[0] || !endpoints[1])
      return fail('open-or-branched-native-face')
    edgeNodes.push([endpoints[0], endpoints[1]])
    for (const key of endpoints) adjacency.set(key, [...(adjacency.get(key) ?? []), index])
  }
  if ([...adjacency.values()].some((edges) => edges.length !== 2)) return fail('branched-corner')
  const start = [...nodes.values()].sort(
    (a, b) => a.point.x - b.point.x || a.point.y - b.point.y,
  )[0]
  if (!start) return fail('no-native-corners')
  const startKey = pointKey(start.point)
  const polygon: PagePoint[] = []
  const visited = new Set<number>()
  let current = startKey
  for (let count = 0; count <= selected.length; count++) {
    if (count > 0 && current === startKey) break
    const node = nodes.get(current)
    const next = adjacency.get(current)?.find((edge) => !visited.has(edge))
    if (!node || next === undefined) return fail('incomplete-native-cycle')
    polygon.push({ ...node.point })
    visited.add(next)
    const endpoints = edgeNodes[next]
    if (!endpoints) return fail('incomplete-native-cycle')
    current = endpoints[0] === current ? endpoints[1] : endpoints[0]
  }
  if (current !== startKey || visited.size !== selected.length)
    return fail('multiple-or-open-native-cycles')
  if (!pdfPolygonIsValid(polygon)) return fail('invalid-native-cycle-polygon')
  const twiceArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    return next ? sum + point.x * next.y - next.x * point.y : sum
  }, 0)
  if (twiceArea < 0) {
    polygon.reverse()
    const firstIndex = polygon.findIndex((point) => pointKey(point) === startKey)
    polygon.push(...polygon.splice(0, firstIndex))
  }
  const omitted = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    omitted.some(
      ({ operationIndex, bounds }) =>
        !Number.isSafeInteger(operationIndex) ||
        operationIndex < 0 ||
        operationIndex >= 100_000 ||
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return fail('invalid-omitted-evidence-bounds')
  const marginX = (OMISSION_EXCLUSION_POINTS * 1000) / work.pageWidth
  const marginY = (OMISSION_EXCLUSION_POINTS * 1000) / work.pageHeight
  const completePaintEvents = pdfPaintInventoryIsComplete(work.paintBounds)
    ? work.paintBounds?.events
    : undefined
  const paintEvents = completePaintEvents
    ? new Map(completePaintEvents.map((event) => [event.operationIndex, event]))
    : null
  for (const [index, face] of selected.entries()) {
    const endpoints = edgeNodes[index]
    const start = endpoints && nodes.get(endpoints[0])?.point
    const end = endpoints && nodes.get(endpoints[1])?.point
    if (!start || !end) return fail('incomplete-native-cycle')
    if (
      completePaintEvents?.some(
        (event) =>
          event.operationIndex > face.operationIndex &&
          pdfPaintMayTouchSpan(event, [start, end], 0.0005),
      )
    )
      return fail('later-paint-may-cover-native-face')
  }
  const selectedOperations = new Set(selected.map((face) => face.operationIndex))
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index],
      b = polygon[(index + 1) % polygon.length]
    if (!a || !b) return fail('incomplete-native-cycle')
    if (
      omitted.some((item) => {
        if (selectedOperations.has(item.operationIndex)) return true
        if (item.paint === 'fill') {
          // A fill's control hull bounds its paint. A stroke's hull does not
          // include its pen, caps or joins and cannot provide this exclusion.
          return pdfPaintMayTouchSpan(
            {
              operationIndex: item.operationIndex,
              kind: 'vector',
              reason: null,
              bounds: {
                left: item.bounds.left - marginX,
                right: item.bounds.right + marginX,
                top: item.bounds.top - marginY,
                bottom: item.bounds.bottom + marginY,
              },
            },
            [a, b],
            0.0005,
          )
        }
        const event = paintEvents?.get(item.operationIndex)
        if (event?.kind !== 'vector') return true
        return pdfPaintMayTouchSpan(event, [a, b], Math.max(marginX, marginY) + 0.0005)
      })
    )
      return fail('omitted-native-evidence-touches-boundary')
  }
  const vertexProofs: PlanPageVertexProof[] = []
  for (const [vertexIndex, point] of polygon.entries()) {
    const proof = nodes.get(pointKey(point))?.proof
    if (proof?.kind !== 'bounded-native-crossing') continue
    const snapshots = proof.faces.map((ref) =>
      selected.find((face) => refKey(face) === refKey(ref)),
    )
    const first = snapshots[0]
    const second = snapshots[1]
    if (snapshots.length !== 2 || !first || !second) return fail('incomplete-native-vertex-proof')
    const snapshot = (segment: NativePageSegment) => ({
      operationIndex: segment.operationIndex,
      subpathIndex: segment.subpathIndex,
      segmentIndex: segment.segmentIndex,
      start: { ...segment.start },
      end: { ...segment.end },
    })
    vertexProofs.push({
      vertexIndex,
      kind: 'bounded-native-crossing',
      segments: [snapshot(first), snapshot(second)],
    })
  }
  return {
    status: 'candidate' as const,
    basis: 'reviewed-native-face-cycle' as const,
    source: reviewed.source,
    coordinateSystem: 'page-0-1000' as const,
    omissionExclusionPoints: OMISSION_EXCLUSION_POINTS,
    polygon,
    vertexProofs,
    vertices: polygon.map((point) => ({
      point: { ...point },
      proof: nodes.get(pointKey(point))?.proof,
    })),
    faces: selected.map((segment, index) => ({
      ref: reviewed.faces[index]?.ref,
      kind: segment.kind,
      endpoints: edgeNodes[index]?.map((key) => nodes.get(key)?.point),
    })),
  }
}
