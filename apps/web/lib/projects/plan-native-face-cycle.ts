import type { PlanPageSegmentRef } from '@uyut/db'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type NativePageSegment,
  nativeEdgeCrossing,
  nativePageSegments,
} from './plan-pdf-opening-endpoint'
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
    work.paths.length > 3000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000 ||
    work.truncated ||
    work.unsupportedPaths ||
    work.unsupportedContexts ||
    (work.skippedCurves &&
      (!work.skippedCurveBounds?.length || work.skippedCurveBoundsTruncated)) ||
    (work.clippedPaths && (!work.clippedPathBounds?.length || work.clippedPathBoundsTruncated))
  )
    return fail('incomplete-native-boundary-inventory')
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
      ({ bounds }) =>
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return fail('invalid-omitted-evidence-bounds')
  const marginX = (OMISSION_EXCLUSION_POINTS * 1000) / work.pageWidth
  const marginY = (OMISSION_EXCLUSION_POINTS * 1000) / work.pageHeight
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index],
      b = polygon[(index + 1) % polygon.length]
    if (!a || !b) return fail('incomplete-native-cycle')
    if (
      omitted.some(
        ({ bounds }) =>
          Math.min(a.x, b.x) <= bounds.right + marginX &&
          Math.max(a.x, b.x) >= bounds.left - marginX &&
          Math.min(a.y, b.y) <= bounds.bottom + marginY &&
          Math.max(a.y, b.y) >= bounds.top - marginY,
      )
    )
      return fail('omitted-native-evidence-touches-boundary')
  }
  return {
    status: 'candidate' as const,
    basis: 'reviewed-native-face-cycle' as const,
    source: reviewed.source,
    coordinateSystem: 'page-0-1000' as const,
    omissionExclusionPoints: OMISSION_EXCLUSION_POINTS,
    polygon,
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
