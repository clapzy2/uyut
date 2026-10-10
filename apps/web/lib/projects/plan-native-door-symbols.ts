import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { PagePoint, PdfCurvePath, PdfLinework } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

type Cubic = Extract<PdfCurvePath['segments'][number], { kind: 'cubic' }>
type SwingArc = Omit<PdfCurvePath, 'segments'> & { segments: Cubic[] }
export type NativeDoorSymbol = {
  id: string
  arc: SwingArc
  leaf: NativePageSegment
  hinge: PagePoint
  closedTip: PagePoint
  endpointResidualPixels: number
  shapeResidualRatio: number
  attachment: 'symbol-fit-only'
  physicalPassageAccepted: false
  closesFloorBoundary: false
}

// Recognition tolerances, NEVER endpoint snapping, floor closure or a metric proof.
const ENDPOINT_FIT_PIXELS = 0.1
const SHAPE_FIT_RATIO = 0.005
const MAX_SYMBOLS = 100
const MAX_FIT_WORK = 200_000
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const distance = (a: PagePoint, b: PagePoint) => Math.hypot(a.x - b.x, a.y - b.y)
const subtract = (a: PagePoint, b: PagePoint) => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: PagePoint, b: PagePoint) => a.x * b.x + a.y * b.y
const cross = (a: PagePoint, b: PagePoint) => a.x * b.y - a.y * b.x
const pointKey = (point: PagePoint) => `${point.x}:${point.y}`

function quarterSwingFit(
  arc: SwingArc,
  hinge: PagePoint,
  raster: (point: PagePoint) => PagePoint,
): number | null {
  const center = raster(hinge)
  let start = raster(arc.start)
  const initial = subtract(start, center)
  const radius = Math.hypot(initial.x, initial.y)
  if (radius < 5) return null
  let totalAngle = 0
  let residual = 0
  let direction = 0
  for (const segment of arc.segments) {
    const end = raster(segment.end)
    const a = subtract(start, center)
    const b = subtract(end, center)
    const angle = Math.atan2(cross(a, b), dot(a, b))
    if (Math.abs(angle) < 0.1 || Math.abs(angle) > Math.PI / 2 + SHAPE_FIT_RATIO) return null
    if (direction && direction !== Math.sign(angle)) return null
    direction = Math.sign(angle)
    totalAngle += angle
    const k = (4 / 3) * Math.tan(angle / 4)
    const expected1 = { x: start.x - k * a.y, y: start.y + k * a.x }
    const expected2 = { x: end.x + k * b.y, y: end.y - k * b.x }
    residual = Math.max(
      residual,
      Math.abs(Math.hypot(b.x, b.y) - radius) / radius,
      distance(raster(segment.control1), expected1) / radius,
      distance(raster(segment.control2), expected2) / radius,
    )
    start = end
  }
  residual = Math.max(residual, Math.abs(Math.abs(totalAngle) - Math.PI / 2))
  return residual <= SHAPE_FIT_RATIO ? residual : null
}

/** Source-painted quarter swings + leaves. Candidate classification, not an opening inventory. */
export function nativeDoorSymbolCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const frame = nativeFillCandidates(input)
  const { work, native } = input
  const scale = native.pageNormalizedScale
  const candidates: NativeDoorSymbol[] = []
  const rejected: { operationIndex: number; subpathIndex: number; reason: string }[] = []
  const finish = (reason: string | null) => ({
    status: reason ? ('unresolved' as const) : ('draft' as const),
    basis: 'native-door-swing-and-leaf-fit' as const,
    source: native.source,
    originalPdfSha256: native.originalPdfSha256,
    candidates: reason ? [] : structuredClone(candidates),
    rejected,
    refusalReason: reason,
    endpointFitLimitPixels: ENDPOINT_FIT_PIXELS,
    shapeFitLimitRatio: SHAPE_FIT_RATIO,
    completeOpeningInventory: false as const,
    closesFloorBoundary: false as const,
  })
  if (frame.refusalReason === 'incomplete-native-layer' || work.curvePathsTruncated || !scale)
    return finish('incomplete-native-layer')
  if (work.skippedCurves && !work.curvePaths) return finish('curve-commands-unavailable')
  const curves = work.curvePaths ?? []
  if (
    curves.length > 3000 ||
    curves.length > work.skippedCurves ||
    curves.reduce((count, path) => count + path.segments.length * 3 + 1, 0) > 20_000
  )
    return finish('curve-command-limit')
  const raster = (p: PagePoint) => ({ x: p.x * scale.x, y: p.y * scale.y })
  const refs = new Set<string>()
  const validPoint = (p: PagePoint) =>
    [p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1000)
  for (const path of [...work.paths, ...curves]) {
    const key = `${path.operationIndex}:${path.subpathIndex}`
    if (
      refs.has(key) ||
      ![path.operationIndex, path.subpathIndex].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      typeof path.closed !== 'boolean' ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint)
    )
      return finish('invalid-native-provenance')
    refs.add(key)
    const points =
      'points' in path
        ? path.points
        : [
            path.start,
            ...path.segments.flatMap((segment) =>
              segment.kind === 'cubic'
                ? [segment.control1, segment.control2, segment.end]
                : segment.kind === 'quadratic'
                  ? [segment.control, segment.end]
                  : [segment.end],
            ),
          ]
    if (points.some((p) => !validPoint(p))) return finish('invalid-native-provenance')
  }
  const counts = new Map<number, number>()
  for (const path of [...work.paths, ...curves])
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  const omitted = new Set((work.clippedPathBounds ?? []).map((item) => item.operationIndex))
  const curveOperations = new Set(
    (work.skippedCurveBounds ?? []).map((item) => item.operationIndex),
  )
  if (
    [...(work.clippedPathBounds ?? []), ...(work.skippedCurveBounds ?? [])].some(
      ({ bounds }) =>
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return finish('invalid-omission-bounds')
  const leaves: NativePageSegment[] = []
  for (const path of work.paths) {
    if (
      path.paint !== 'stroke' ||
      counts.get(path.operationIndex) !== 1 ||
      curveOperations.has(path.operationIndex) ||
      omitted.has(path.operationIndex)
    )
      continue
    let points = path.points
    const first = points[0],
      last = points.at(-1)
    if (!first || !last) continue
    if (samePoint(first, last)) points = points.slice(0, -1)
    if (!path.closed && points.length === 2) {
      leaves.push({
        operationIndex: path.operationIndex,
        subpathIndex: path.subpathIndex,
        segmentIndex: 0,
        start: first,
        end: last,
      })
    } else if (path.closed && points.length === 4) {
      // Only a thin, orthogonal source rectangle; no furniture outline chosen by proximity.
      if (!pdfPolygonIsValid(points)) continue
      const vectors = points.map((p, i) =>
        subtract(raster(points[(i + 1) % 4] as PagePoint), raster(p)),
      )
      const lengths = vectors.map((v) => Math.hypot(v.x, v.y))
      if (
        lengths.some((length) => length === 0) ||
        vectors.some(
          (v, i) =>
            Math.abs(dot(v, vectors[(i + 1) % 4] as PagePoint)) /
              ((lengths[i] as number) * (lengths[(i + 1) % 4] as number)) >
            SHAPE_FIT_RATIO,
        ) ||
        Math.min(...lengths) / Math.max(...lengths) > 0.08
      )
        continue
      for (let i = 0; i < 4; i++) {
        if ((lengths[i] as number) < Math.max(...lengths) * 0.99) continue
        leaves.push({
          operationIndex: path.operationIndex,
          subpathIndex: path.subpathIndex,
          segmentIndex: i,
          start: points[i] as PagePoint,
          end: points[(i + 1) % 4] as PagePoint,
        })
      }
    }
  }
  let fitWork = 0
  for (const curve of curves) {
    const reject = (reason: string) => {
      if (rejected.length < 100)
        rejected.push({
          operationIndex: curve.operationIndex,
          subpathIndex: curve.subpathIndex,
          reason,
        })
    }
    if (
      curve.paint !== 'stroke' ||
      curve.closed ||
      curve.operationSubpathCount !== 1 ||
      counts.get(curve.operationIndex) !== 1 ||
      omitted.has(curve.operationIndex) ||
      !curveOperations.has(curve.operationIndex) ||
      curve.segments.length < 1 ||
      curve.segments.length > 4 ||
      curve.segments.some((segment) => segment.kind !== 'cubic')
    ) {
      reject('unsupported-swing-path')
      continue
    }
    const arc = curve as SwingArc
    const points = [
      arc.start,
      ...arc.segments.flatMap((segment) => [segment.control1, segment.control2, segment.end]),
    ]
    const bounds = {
      left: Math.min(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      right: Math.max(...points.map((p) => p.x)),
      bottom: Math.max(...points.map((p) => p.y)),
    }
    if (
      !(work.skippedCurveBounds ?? []).some(
        (item) =>
          item.operationIndex === arc.operationIndex &&
          Object.entries(bounds).every(
            ([key, value]) => item.bounds[key as keyof typeof bounds] === value,
          ),
      )
    ) {
      reject('stale-curve-command-bounds')
      continue
    }
    const end = arc.segments.at(-1)?.end
    if (!end) continue
    const fits = new Map<
      string,
      {
        leaf: NativePageSegment
        hinge: PagePoint
        closedTip: PagePoint
        endpointResidual: number
        shapeResidual: number
      }
    >()
    for (const leaf of leaves) {
      if (++fitWork > MAX_FIT_WORK) return finish('symbol-search-budget')
      for (const [hinge, tip] of [
        [leaf.start, leaf.end],
        [leaf.end, leaf.start],
      ] as const) {
        for (const [openTip, closedTip] of [
          [arc.start, end],
          [end, arc.start],
        ] as const) {
          const endpointResidual = distance(raster(tip), raster(openTip))
          if (endpointResidual > ENDPOINT_FIT_PIXELS) continue
          const shapeResidual = quarterSwingFit(arc, hinge, raster)
          if (shapeResidual === null) continue
          // Exact repaint aliases only; never select the closest of competing hinges.
          const key = `${pointKey(hinge)}:${pointKey(tip)}:${pointKey(closedTip)}`
          if (!fits.has(key))
            fits.set(key, { leaf, hinge, closedTip, endpointResidual, shapeResidual })
        }
      }
    }
    const fit = fits.size === 1 ? [...fits.values()][0] : undefined
    if (!fit) {
      reject(fits.size ? 'ambiguous-leaf-attachment' : 'no-quarter-swing-leaf-fit')
      continue
    }
    if (candidates.length === MAX_SYMBOLS) return finish('symbol-candidate-limit')
    candidates.push({
      id: `native-door-symbol-${arc.operationIndex}:${arc.subpathIndex}`,
      arc,
      leaf: fit.leaf,
      hinge: fit.hinge,
      closedTip: fit.closedTip,
      endpointResidualPixels: fit.endpointResidual,
      shapeResidualRatio: fit.shapeResidual,
      attachment: 'symbol-fit-only',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
  }
  return finish(null)
}
