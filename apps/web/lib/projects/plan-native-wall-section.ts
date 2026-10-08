import type { NativeTextAnchors } from './plan-document'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import { exactNativeCrossing, exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import { type PdfPlanSource, pdfPointInside, pdfPolygonIsValid } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

export type ReviewedNativeWallSection = {
  review: 'manual-native-wall-section-review'
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  axis: 'width' | 'depth'
  at: number
  from: number
  to: number
  walls: { operationIndex: number; subpathIndex: number; polygon: PagePoint[] }[]
}
type Gap = {
  from: number
  to: number
  start: PagePoint
  end: PagePoint
  startJambs: NativePageSegment[]
  endJambs: NativePageSegment[]
  boundedByReviewedWalls: boolean
  unknownFillOperations: number[]
  dimensionLabelIds: string[]
  printedWidthMm: number | null
  openingKind: null
}
const samePolygon = (a: PagePoint[], b: PagePoint[]) =>
  a.length === b.length &&
  a.every((point, index) => point.x === b[index]?.x && point.y === b[index]?.y)

/** A source-reviewed wall section is not a complete wall/floor inventory or an opening type. */
export function nativeWallSectionGaps(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  reviewed: ReviewedNativeWallSection
}) {
  const { native, work, reviewed } = input
  const inventory = nativeFillCandidates(input)
  const gaps: Gap[] = []
  const sectionCrossings: {
    point: PagePoint
    sourceEdge: NativePageSegment
    kind: 'axis-source-coordinate' | 'computed-source-edge-crossing'
    exactPointKey: string
  }[] = []
  const finish = (reason: string | null) => ({
    status: 'draft' as const,
    basis: 'reviewed-native-wall-section-gaps' as const,
    source: reviewed.source,
    rasterSource: native.source,
    gaps: reason ? [] : structuredClone(gaps),
    sectionCrossings: reason ? [] : structuredClone(sectionCrossings),
    refusalReason: reason,
    coverageScope: 'selected-wall-section-only' as const,
    confirmsOpeningKind: false as const,
    closesFloorBoundary: false as const,
  })
  if (
    reviewed.review !== 'manual-native-wall-section-review' ||
    reviewed.source.state !== 'existing' ||
    reviewed.source.sha256 !== native.originalPdfSha256 ||
    reviewed.source.pdfPage !== native.source.page
  )
    return finish('wall-section-source-mismatch')
  bindObservedRegionLabels({
    regionSource: native.source,
    labelSource: reviewed.rasterSource,
    regions: [],
    labels: [],
  })
  if (inventory.refusalReason === 'incomplete-native-layer')
    return finish('incomplete-native-layer')
  if (
    !['width', 'depth'].includes(reviewed.axis) ||
    ![reviewed.at, reviewed.from, reviewed.to].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
    ) ||
    reviewed.from >= reviewed.to ||
    reviewed.walls.length < 1 ||
    reviewed.walls.length > 100
  )
    return finish('invalid-wall-section')
  const pathKeys = work.paths.map((path) => `${path.operationIndex}:${path.subpathIndex}`)
  if (
    new Set(pathKeys).size !== pathKeys.length ||
    work.paths.some(
      (path) =>
        ![path.operationIndex, path.subpathIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        path.points.some((point) =>
          [point.x, point.y].some((value) => !Number.isFinite(value) || value < 0 || value > 1000),
        ),
    )
  )
    return finish('invalid-native-provenance')
  const keys = reviewed.walls.map((wall) => `${wall.operationIndex}:${wall.subpathIndex}`)
  if (new Set(keys).size !== keys.length) return finish('duplicate-reviewed-wall')
  const operations = new Map<number, number>()
  for (const path of work.paths)
    operations.set(path.operationIndex, (operations.get(path.operationIndex) ?? 0) + 1)
  const omitted = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    omitted.some(
      ({ bounds }) =>
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return finish('invalid-omission-bounds')
  const along = reviewed.axis === 'width' ? 'x' : 'y',
    across = reviewed.axis === 'width' ? 'y' : 'x'
  const pointAt = (position: number): PagePoint =>
    reviewed.axis === 'width' ? { x: position, y: reviewed.at } : { x: reviewed.at, y: position }
  if (
    omitted.some(({ bounds }) =>
      reviewed.axis === 'width'
        ? bounds.top <= reviewed.at &&
          bounds.bottom >= reviewed.at &&
          bounds.right >= reviewed.from &&
          bounds.left <= reviewed.to
        : bounds.left <= reviewed.at &&
          bounds.right >= reviewed.at &&
          bounds.bottom >= reviewed.from &&
          bounds.top <= reviewed.to,
    )
  )
    return finish('omitted-geometry-at-section')
  const bodies = []
  const jambs = new Map<number, NativePageSegment[]>()
  const cuts = new Set([reviewed.from, reviewed.to])
  const cutKeys = new Map(
    [reviewed.from, reviewed.to].map((position) => [
      position,
      exactNativePointKey(pointAt(position)),
    ]),
  )
  for (const wall of reviewed.walls) {
    const path = work.paths.find(
      (path) =>
        path.operationIndex === wall.operationIndex && path.subpathIndex === wall.subpathIndex,
    )
    const points = path?.points ?? []
    const first = points[0],
      last = points.at(-1)
    const polygon =
      first && last && first.x === last.x && first.y === last.y ? points.slice(0, -1) : points
    if (
      ![wall.operationIndex, wall.subpathIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      !path ||
      !['fill', 'fill-stroke'].includes(path.paint) ||
      !path.closed ||
      operations.get(path.operationIndex) !== 1 ||
      omitted.some((item) => item.operationIndex === path.operationIndex) ||
      !samePolygon(path.points, wall.polygon) ||
      !pdfPolygonIsValid(polygon)
    )
      return finish('stale-or-unsupported-reviewed-wall')
    const transverse = path.points.map((point) => point[across])
    if (reviewed.at <= Math.min(...transverse) || reviewed.at >= Math.max(...transverse))
      return finish('section-misses-reviewed-wall')
    for (const [index, start] of path.points.entries()) {
      const end = path.points[(index + 1) % path.points.length]
      if (!end) return finish('incomplete-wall-polygon')
      if (
        Math.max(start[along], end[along]) < reviewed.from ||
        Math.min(start[along], end[along]) > reviewed.to
      )
        continue
      if (start[across] === reviewed.at || end[across] === reviewed.at)
        return finish('section-touches-wall-vertex')
      if ((start[across] - reviewed.at) * (end[across] - reviewed.at) >= 0) continue
      const sourceEdge = {
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: index,
        start,
        end,
      }
      let cutPoint = pointAt(start[along]),
        rationalKey = exactNativePointKey(cutPoint),
        kind: 'axis-source-coordinate' | 'computed-source-edge-crossing' = 'axis-source-coordinate'
      if (start[along] !== end[along]) {
        // Arithmetic probe only, not a new native stroke or a floor boundary.
        const probe = {
          operationIndex: -1,
          subpathIndex: -1,
          segmentIndex: -1,
          start: pointAt(0),
          end: pointAt(1000),
        }
        const crossing = exactNativeCrossing(probe, sourceEdge)
        if (!crossing.point) return finish(crossing.reason)
        cutPoint = crossing.point
        rationalKey = crossing.exactPointKey
        kind = 'computed-source-edge-crossing'
      }
      const position = cutPoint[along]
      if (position < reviewed.from || position > reviewed.to) continue
      if (!rationalKey) return finish('unsupported-section-coordinate-precision')
      const previousKey = cutKeys.get(position)
      if (previousKey && previousKey !== rationalKey) return finish('unrepresentable-section-cut')
      cutKeys.set(position, rationalKey)
      cuts.add(position)
      sectionCrossings.push({ point: cutPoint, sourceEdge, kind, exactPointKey: rationalKey })
      const sources = jambs.get(position) ?? []
      sources.push(sourceEdge)
      jambs.set(position, sources)
    }
    bodies.push(path)
  }
  const sorted = [...cuts].sort((a, b) => a - b)
  for (let index = 1; index < sorted.length; index++) {
    const from = sorted[index - 1],
      to = sorted[index]
    if (from === undefined || to === undefined || from === to) continue
    const midpoint = from / 2 + to / 2
    if (midpoint <= from || midpoint >= to) return finish('unrepresentable-section-interval')
    if (bodies.some((body) => pdfPointInside(pointAt(midpoint), body.points))) continue
    const prior = gaps.at(-1)
    if (prior?.to === from) {
      prior.to = to
      prior.end = pointAt(to)
      prior.endJambs = jambs.get(to) ?? []
      continue
    }
    gaps.push({
      from,
      to,
      start: pointAt(from),
      end: pointAt(to),
      startJambs: jambs.get(from) ?? [],
      endJambs: jambs.get(to) ?? [],
      boundedByReviewedWalls: false,
      unknownFillOperations: [],
      dimensionLabelIds: [],
      printedWidthMm: null,
      openingKind: null,
    })
  }
  const selected = new Set(keys)
  const roles = automaticNativeDimensionRoles({ ...input, source: reviewed.source })
  for (const gap of gaps) {
    gap.boundedByReviewedWalls = gap.startJambs.length > 0 && gap.endJambs.length > 0
    gap.unknownFillOperations = [
      ...new Set(
        work.paths
          .filter(
            (path) =>
              path.paint !== 'stroke' &&
              !selected.has(`${path.operationIndex}:${path.subpathIndex}`) &&
              path.points.some((point) => point[across] < reviewed.at) &&
              path.points.some((point) => point[across] > reviewed.at) &&
              Math.max(...path.points.map((point) => point[along])) > gap.from &&
              Math.min(...path.points.map((point) => point[along])) < gap.to,
          )
          .map((path) => path.operationIndex),
      ),
    ]
    if (!gap.boundedByReviewedWalls || gap.unknownFillOperations.length || roles.refusalReason)
      continue
    const dimensions = roles.candidates.filter(
      (candidate) =>
        candidate.axis === reviewed.axis &&
        candidate.spanEnds.every((point) => point[across] === reviewed.at) &&
        Math.min(...candidate.spanEnds.map((point) => point[along])) === gap.from &&
        Math.max(...candidate.spanEnds.map((point) => point[along])) === gap.to,
    )
    if (dimensions.length === 1) {
      gap.dimensionLabelIds = [dimensions[0]?.labelId as string]
      gap.printedWidthMm = dimensions[0]?.valueMm ?? null
    }
  }
  return finish(null)
}
