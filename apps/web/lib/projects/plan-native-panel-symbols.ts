import type { NativeTextAnchors } from './plan-document'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import {
  type Bounds,
  type PagePoint,
  type PdfLinework,
  type PdfVectorPath,
  pdfVectorRectangle,
} from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativePanelSymbol = {
  id: string
  body: PdfVectorPath
  caps: [PdfVectorPath, PdfVectorPath]
  sides: [NativePageSegment[], NativePageSegment[]]
  centerline: NativePageSegment | null
  centerlineStatus: 'absent' | 'matched' | 'ambiguous'
  centerlineResidualPixels: number | null
  glazingHint: 'independent-centered-line' | 'unclassified-panel'
  physicalPassageAccepted: false
  closesFloorBoundary: false
}

const MAX_PANELS = 100
const MAX_COMPARISONS = 200_000
const MAX_BODY_ASPECT = 0.25
// PDF coordinates are retained at three decimal places. This is symbol fitting,
// never a join tolerance, source coordinate correction or floor boundary proof.
const CENTERLINE_FIT_PIXELS = 0.002
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const pathKey = (path: PdfVectorPath) => `${path.operationIndex}:${path.subpathIndex}`

function edges(path: PdfVectorPath): NativePageSegment[] {
  const first = path.points[0],
    last = path.points.at(-1)
  const points = first && last && samePoint(first, last) ? path.points.slice(0, -1) : path.points
  return points.map((start, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start,
    end: points[(segmentIndex + 1) % points.length] as PagePoint,
  }))
}

/** Three painted rectangles form a panel profile, not a door/window or a free floor. */
export function nativePanelSymbolCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { native, work } = input
  const frame = nativeFillCandidates(input)
  const scale = native.pageNormalizedScale
  const candidates: NativePanelSymbol[] = []
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
  const finish = (reason: string | null) => ({
    status: reason ? ('unresolved' as const) : ('draft' as const),
    basis: 'native-body-and-two-endcap-profile' as const,
    coverageScope: 'axis-aligned-painted-panels-only' as const,
    source: native.source,
    originalPdfSha256: native.originalPdfSha256,
    panels: reason ? [] : structuredClone(candidates),
    rejected,
    rejectedCount,
    diagnosticsTruncated: rejectedCount > rejected.length,
    refusalReason: reason,
    centerlineFitLimitPixels: CENTERLINE_FIT_PIXELS,
    completeOpeningInventory: false as const,
    closesFloorBoundary: false as const,
  })
  if (frame.refusalReason === 'incomplete-native-layer' || work.curvePathsTruncated || !scale)
    return finish('incomplete-native-layer')
  const omissions = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
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
  const counts = new Map<number, number>()
  const refs = new Set<string>()
  for (const path of work.paths) {
    const ref = pathKey(path)
    if (
      refs.has(ref) ||
      ![path.operationIndex, path.subpathIndex].every(
        (number) => Number.isSafeInteger(number) && number >= 0,
      ) ||
      typeof path.closed !== 'boolean' ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint)
    )
      return finish('invalid-native-provenance')
    if (path.points.some((point) => exactNativePointKey(point) === null))
      return finish('unsupported-source-coordinate-precision')
    refs.add(ref)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  }
  const curves = work.curvePaths ?? []
  const curveOperations = new Set(
    (work.skippedCurveBounds ?? []).map((item) => item.operationIndex),
  )
  if (
    curves.length > work.skippedCurves ||
    curves.length > 3000 ||
    curves.reduce((count, path) => count + path.segments.length * 3 + 1, 0) > 20_000
  )
    return finish('invalid-curve-provenance')
  for (const path of curves) {
    const ref = `${path.operationIndex}:${path.subpathIndex}`
    if (
      refs.has(ref) ||
      ![path.operationIndex, path.subpathIndex].every(
        (number) => Number.isSafeInteger(number) && number >= 0,
      ) ||
      !Number.isSafeInteger(path.operationSubpathCount) ||
      path.operationSubpathCount <= path.subpathIndex ||
      typeof path.closed !== 'boolean' ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint) ||
      !curveOperations.has(path.operationIndex)
    )
      return finish('invalid-curve-provenance')
    const points = [
      path.start,
      ...path.segments.flatMap((segment) =>
        segment.kind === 'cubic'
          ? [segment.control1, segment.control2, segment.end]
          : segment.kind === 'quadratic'
            ? [segment.control, segment.end]
            : [segment.end],
      ),
    ]
    if (points.some((point) => exactNativePointKey(point) === null))
      return finish('invalid-curve-provenance')
    refs.add(ref)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  }
  const supported = (path: PdfVectorPath) =>
    path.paint === 'stroke' &&
    counts.get(path.operationIndex) === 1 &&
    !omittedOperations.has(path.operationIndex)
  const rectangles: { path: PdfVectorPath; bounds: Bounds }[] = []
  const lines: NativePageSegment[] = []
  for (const path of work.paths) {
    if (!supported(path)) continue
    const bounds = pdfVectorRectangle(path)
    if (bounds) rectangles.push({ path, bounds })
    const start = path.points[0],
      end = path.points[1]
    if (!path.closed && path.points.length === 2 && start && end && !samePoint(start, end))
      lines.push({
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: 0,
        start,
        end,
      })
  }
  let comparisons = 0
  const spend = () => ++comparisons <= MAX_COMPARISONS
  const pending: NativePanelSymbol[] = []
  const capOwners = new Map<string, Set<string>>()
  for (const { path: body, bounds } of rectangles) {
    const width = (bounds.right - bounds.left) * scale.x
    const height = (bounds.bottom - bounds.top) * scale.y
    if (
      Math.min(width, height) <= 0 ||
      Math.max(width, height) < 5 ||
      Math.min(width, height) / Math.max(width, height) > MAX_BODY_ASPECT
    )
      continue
    const along = width > height ? 'x' : 'y'
    const across = along === 'x' ? 'y' : 'x'
    const range = (box: Bounds) =>
      along === 'x'
        ? { from: box.left, to: box.right, near: box.top, far: box.bottom }
        : { from: box.top, to: box.bottom, near: box.left, far: box.right }
    const bodyRange = range(bounds)
    const caps: [PdfVectorPath[], PdfVectorPath[]] = [[], []]
    for (const { path: cap, bounds: capBounds } of rectangles) {
      if (!spend()) return finish('panel-search-budget')
      if (cap === body) continue
      const capRange = range(capBounds)
      if (capRange.near !== bodyRange.near || capRange.far !== bodyRange.far) continue
      const capLength = (capRange.to - capRange.from) * scale[along]
      const depth = (bodyRange.far - bodyRange.near) * scale[across]
      if (capLength < depth / 2 || capLength > depth * 2) continue
      // Full edge joins only. A one-billionth source gap or overlap is not repaired.
      if (capRange.to === bodyRange.from) caps[0].push(cap)
      if (capRange.from === bodyRange.to) caps[1].push(cap)
      if (capRange.to === bodyRange.from || capRange.from === bodyRange.to) {
        const owners = capOwners.get(pathKey(cap)) ?? new Set<string>()
        owners.add(pathKey(body))
        capOwners.set(pathKey(cap), owners)
      }
    }
    const firstCap = caps[0][0],
      lastCap = caps[1][0]
    if (caps[0].length !== 1 || caps[1].length !== 1 || !firstCap || !lastCap) {
      reject(
        body,
        caps.some((matches) => matches.length > 1)
          ? 'competing-panel-caps'
          : 'no-two-exact-endcaps',
      )
      continue
    }
    const sides: NativePanelSymbol['sides'] = [[], []]
    for (const [index, coordinate] of [bodyRange.near, bodyRange.far].entries()) {
      for (const path of [firstCap, body, lastCap]) {
        const side = edges(path).find(
          (edge) =>
            edge.start[across] === coordinate &&
            edge.end[across] === coordinate &&
            edge.start[along] !== edge.end[along],
        )
        if (!side) return finish('invalid-panel-edge-provenance')
        sides[index as 0 | 1].push(side)
      }
    }
    const fittedLines: { line: NativePageSegment; residual: number }[] = []
    for (const line of lines) {
      if (!spend()) return finish('panel-search-budget')
      if (
        line.start[across] !== line.end[across] ||
        Math.min(line.start[along], line.end[along]) !== bodyRange.from ||
        Math.max(line.start[along], line.end[along]) !== bodyRange.to
      )
        continue
      const coordinate = line.start[across]
      if (coordinate <= bodyRange.near || coordinate >= bodyRange.far) continue
      const residual = Math.abs(coordinate - (bodyRange.near + bodyRange.far) / 2) * scale[across]
      if (residual <= CENTERLINE_FIT_PIXELS) fittedLines.push({ line, residual })
    }
    const fit = fittedLines.length === 1 ? fittedLines[0] : undefined
    if (fittedLines.length > 1) reject(body, 'competing-panel-centerlines')
    if (pending.length === MAX_PANELS) return finish('panel-candidate-limit')
    pending.push({
      id: `native-panel-symbol-${pathKey(body)}`,
      body,
      caps: [firstCap, lastCap],
      sides,
      centerline: fit?.line ?? null,
      centerlineStatus: fit ? 'matched' : fittedLines.length > 1 ? 'ambiguous' : 'absent',
      centerlineResidualPixels: fit?.residual ?? null,
      glazingHint: fit ? 'independent-centered-line' : 'unclassified-panel',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
  }
  for (const panel of pending) {
    if (panel.caps.some((cap) => (capOwners.get(pathKey(cap))?.size ?? 0) > 1))
      reject(panel.body, 'competing-panel-bodies')
    else candidates.push(panel)
  }
  return finish(null)
}
