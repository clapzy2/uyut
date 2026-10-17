import { nativeCaptionKnownPaintBlockers } from './plan-native-caption-paint'
import { exactNativeOrientation } from './plan-native-exact-intersections'
import { nativeHeightGroupBounds, nativeResetNoteBounds } from './plan-native-height-group'
import { nativeHeightSourceLocations } from './plan-native-height-locations'
import { nativeHeightObservations } from './plan-native-height-observations'
import type { PagePoint, PdfCurvePath, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeHeightObservations>[0]
type PathRef = { operationIndex: number; subpathIndex: number }
type SegmentRef = PathRef & { segmentIndex: number }
export type NativeHeightCalloutCandidate = {
  id: string
  stem: { source: SegmentRef; start: PagePoint; end: PagePoint }
  horizontal: { source: SegmentRef; start: PagePoint; end: PagePoint }
  dot: { source: PathRef; polygon: PagePoint[] }
  outline: PathRef
  calloutEnd: PagePoint
  possibleTextLabelIds: string[]
  heightCaptions: { labelId: string; sourceOperations: number[] }[]
  sharedHeightCaptionIds: string[]
  textBlockStatus: 'unverified'
  objectStatus: 'unresolved'
}
const MAX_WORK = 200_000
const same = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const ref = (path: PathRef): PathRef => ({
  operationIndex: path.operationIndex,
  subpathIndex: path.subpathIndex,
})
const segmentRef = (path: PathRef): SegmentRef => ({ ...ref(path), segmentIndex: 0 })

function dotPolygon(path: PdfVectorPath, frame: Input['work']) {
  if (path.paint !== 'fill' || path.fillColor !== '#000000' || !path.closed) return null
  if (path.points.length < 8 || path.points.length > 33) return null
  const points = same(path.points[0] as PagePoint, path.points.at(-1) as PagePoint)
    ? path.points.slice(0, -1)
    : path.points
  if (points.length < 8 || points.length > 32) return null
  const turns = points.map((point, index) =>
    exactNativeOrientation(
      point,
      points[(index + 1) % points.length] as PagePoint,
      points[(index + 2) % points.length] as PagePoint,
    ),
  )
  if (!turns.every((turn) => turn === 1) && !turns.every((turn) => turn === -1)) return null
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  const width = ((right - left) * frame.pageWidth) / 1000
  const height = ((bottom - top) * frame.pageHeight) / 1000
  // Symbol scope, never a coordinate snap or evidence of a physical opening.
  if (width < 0.5 || width > 5 || height < 0.5 || height > 5) return null
  return { points, left, right, top, bottom }
}

function matchingOutline(outline: PdfCurvePath, dot: NonNullable<ReturnType<typeof dotPolygon>>) {
  if (
    !Number.isSafeInteger(outline.operationIndex) ||
    outline.operationIndex < 0 ||
    !Number.isSafeInteger(outline.subpathIndex) ||
    outline.subpathIndex < 0 ||
    outline.paint !== 'stroke' ||
    outline.strokeColor !== '#000000' ||
    !outline.closed ||
    outline.operationSubpathCount !== 1 ||
    outline.segments.length !== 4 ||
    outline.segments.some((segment) => segment.kind !== 'cubic')
  )
    return false
  const ends = outline.segments.map((segment) => segment.end)
  const first = ends[0],
    last = ends.at(-1)
  if (!first || !last || !same(last, outline.start)) return false
  // Source decimal rounding can make the centre asymmetric. Use the literal
  // extrema on both source shapes, not a fitted ellipse or an averaged point.
  return (
    ends.every((point) => dot.points.some((vertex) => same(point, vertex))) &&
    ends.filter((point) => point.x === dot.left).length === 1 &&
    ends.filter((point) => point.x === dot.right).length === 1 &&
    ends.filter((point) => point.y === dot.top).length === 1 &&
    ends.filter((point) => point.y === dot.bottom).length === 1 &&
    outline.segments.every(
      (segment) =>
        segment.kind === 'cubic' &&
        [segment.control1, segment.control2].every(
          (point) =>
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x >= dot.left &&
            point.x <= dot.right &&
            point.y >= dot.top &&
            point.y <= dot.bottom,
        ),
    )
  )
}

/** Literal L/dot source suggestions only. Text columns are hints, not owners. */
export function nativeHeightCalloutCandidates(input: Input) {
  const candidates: NativeHeightCalloutCandidate[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    source: { ...input.source },
    image: { ...input.native.source },
    candidates: refusalReason ? [] : structuredClone(candidates),
    textBlockOwnershipConfirmed: false as const,
    physicalObjectAccepted: false as const,
    mayTransfer2D3D: false as const,
    readOnly: true as const,
  })
  const heights = nativeHeightObservations(input)
  if (heights.refusalReason) return finish(heights.refusalReason)
  const { native, work } = input
  if (
    work.truncated ||
    work.unsupportedPaths ||
    work.unsupportedContexts ||
    work.curvePathsTruncated ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated
  )
    return finish('height-callout-source-incomplete')
  if ((work.curvePaths?.length ?? 0) !== work.skippedCurves)
    return finish('height-callout-curve-inventory-incomplete')
  if (work.paths.length > 5000 || (work.curvePaths?.length ?? 0) > 5000)
    return finish('height-callout-source-limit')
  const ink = native.heightCaptionInk
  if (
    !ink ||
    native.vectorInkRefusal ||
    ink.refusalReason ||
    ink.source.sha256 !== input.source.sha256 ||
    ink.source.pdfPage !== input.source.pdfPage ||
    ink.source.pageWidth !== work.pageWidth ||
    ink.source.pageHeight !== work.pageHeight
  )
    return finish('height-callout-caption-ink-unavailable')
  const locations = nativeHeightSourceLocations(input)
  if (locations.refusalReason) return finish(locations.refusalReason)
  const heightRefs = new Map<string, number[]>()
  for (const observation of heights.observations) {
    const label = native.labels.find((label) => label.id === observation.labelId)
    const item = ink.items.find((item) => item.index === label?.nativeIndex)
    if (!label || !item || item.text !== label.name) continue
    const location = locations.observations.find((row) => row.labelId === label.id)
    if (location?.inkSourceOperation !== item.operationIndex) continue
    const bounds = item.sourceResetCaption
      ? nativeResetNoteBounds(item, label, work)
      : item.sourceGroup
        ? nativeHeightGroupBounds(item, label, work)
        : item.quad
    if (!bounds) continue
    const refs = item.sourceResetCaption?.shows.map((show) => show.operationIndex) ??
      item.sourceGroup?.operationIndexes ?? [item.operationIndex]
    const blockers = nativeCaptionKnownPaintBlockers(work.paintBounds, refs, bounds)
    if (blockers === null || blockers.length > 0) continue
    heightRefs.set(label.id, refs)
  }
  const operationCounts = new Map<number, number>()
  for (const path of [...work.paths, ...(work.curvePaths ?? [])])
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
  const lines = work.paths.filter(
    (path) =>
      operationCounts.get(path.operationIndex) === 1 &&
      path.paint === 'stroke' &&
      path.strokeColor === '#000000' &&
      !path.closed &&
      path.points.length === 2 &&
      path.strokeInk?.refusalReason === null &&
      path.strokeInk.dashArray.length === 0,
  )
  const dots = work.paths.flatMap((path) => {
    if (operationCounts.get(path.operationIndex) !== 1) return []
    const dot = dotPolygon(path, work)
    return dot ? [{ path, dot }] : []
  })
  let spent = 0
  for (const { path, dot } of dots) {
    const outlines = (work.curvePaths ?? []).filter((curve) => {
      if (++spent > MAX_WORK) return false
      return operationCounts.get(curve.operationIndex) === 1 && matchingOutline(curve, dot)
    })
    if (spent > MAX_WORK) return finish('height-callout-work-limit')
    if (outlines.length !== 1) continue
    const outline = outlines[0] as PdfCurvePath
    const stems = lines.flatMap((line) => {
      if (++spent > MAX_WORK) return []
      const a = line.points[0] as PagePoint,
        b = line.points[1] as PagePoint
      const top = a.y < b.y ? a : b,
        bottom = a.y < b.y ? b : a
      return a.x === b.x &&
        top.y < bottom.y &&
        bottom.y === dot.top &&
        dot.points.some((point) => same(point, bottom))
        ? [{ line, top, bottom }]
        : []
    })
    if (spent > MAX_WORK) return finish('height-callout-work-limit')
    if (stems.length !== 1) continue
    const { line: stem, top, bottom } = stems[0] as (typeof stems)[number]
    const elbows = lines.flatMap((line) => {
      if (++spent > MAX_WORK) return []
      const a = line.points[0] as PagePoint,
        b = line.points[1] as PagePoint
      if (a.y !== b.y) return []
      return same(a, top) && b.x > a.x
        ? [{ line, end: b }]
        : same(b, top) && a.x > b.x
          ? [{ line, end: a }]
          : []
    })
    if (spent > MAX_WORK) return finish('height-callout-work-limit')
    if (elbows.length !== 1) continue
    const { line: horizontal, end } = elbows[0] as (typeof elbows)[number]
    const stemLength = ((bottom.y - top.y) * work.pageHeight) / 1000
    const horizontalLength = ((end.x - top.x) * work.pageWidth) / 1000
    if (stemLength < 2 || stemLength > 200 || horizontalLength < 0.5 || horizontalLength > 100)
      continue
    const ownOperations = [
      stem.operationIndex,
      horizontal.operationIndex,
      path.operationIndex,
      outline.operationIndex,
    ]
    const envelope = [top, bottom, end, ...dot.points]
    const blockers = nativeCaptionKnownPaintBlockers(work.paintBounds, ownOperations, envelope)
    if (blockers === null || blockers.length > 0) continue
    // This bounded alignment window only offers text for explicit review.
    // It never establishes a multiline source owner or chooses an opening.
    const possibleLabels = native.labels.filter(
      (label) =>
        label.pagePoint &&
        label.rotation === 0 &&
        Math.abs(((label.pagePoint.x - end.x) * work.pageWidth) / 1000) <= 1 &&
        ((label.pagePoint.y - end.y) * work.pageHeight) / 1000 >= -150 &&
        ((label.pagePoint.y - end.y) * work.pageHeight) / 1000 <= 10,
    )
    if (possibleLabels.length > 25) continue
    const captions = possibleLabels.flatMap((label) => {
      const sourceOperations = heightRefs.get(label.id)
      return sourceOperations ? [{ labelId: label.id, sourceOperations }] : []
    })
    if (!captions.length) continue
    candidates.push({
      id: `native-height-callout-${stem.operationIndex}:${stem.subpathIndex}`,
      stem: { source: segmentRef(stem), start: { ...top }, end: { ...bottom } },
      horizontal: { source: segmentRef(horizontal), start: { ...top }, end: { ...end } },
      dot: { source: ref(path), polygon: dot.points.map((point) => ({ ...point })) },
      outline: ref(outline),
      calloutEnd: { ...end },
      possibleTextLabelIds: possibleLabels.map((label) => label.id),
      heightCaptions: captions,
      sharedHeightCaptionIds: [],
      textBlockStatus: 'unverified',
      objectStatus: 'unresolved',
    })
    if (candidates.length > 50) return finish('height-callout-candidate-limit')
  }
  const captionCounts = new Map<string, number>()
  for (const candidate of candidates) {
    for (const caption of candidate.heightCaptions) {
      captionCounts.set(caption.labelId, (captionCounts.get(caption.labelId) ?? 0) + 1)
    }
  }
  for (const candidate of candidates) {
    candidate.sharedHeightCaptionIds = candidate.heightCaptions
      .filter((caption) => (captionCounts.get(caption.labelId) ?? 0) > 1)
      .map((caption) => caption.labelId)
  }
  return finish(null)
}
