import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { Bounds, PagePoint, PdfCurvePath, PdfLinework } from './plan-pdf-linework'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeNumberCircleCue = {
  labelId: string
  sourceNumber: number
  pagePoint: PagePoint
  bounds: Bounds
  curve: PdfCurvePath
}

// A symbol fit only: the source commands and label origin are never moved.
const SHAPE_FIT_RATIO = 0.005
const MAX_CUES = 100
const MAX_WORK = 200_000
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const pathKey = (path: Pick<PdfCurvePath, 'operationIndex' | 'subpathIndex'>) =>
  `${path.operationIndex}:${path.subpathIndex}`
const validPoint = (point: PagePoint) =>
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

function curvePoints(curve: PdfCurvePath): PagePoint[] {
  return [
    curve.start,
    ...curve.segments.flatMap((segment) => {
      if (segment.kind === 'cubic') return [segment.control1, segment.control2, segment.end]
      if (segment.kind === 'quadratic') return [segment.control, segment.end]
      return [segment.end]
    }),
  ]
}

function pointBounds(points: PagePoint[]): Bounds {
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  }
}

function circleFit(curve: PdfCurvePath, scale: { x: number; y: number }): Bounds | null {
  if (
    curve.paint !== 'stroke' ||
    !curve.closed ||
    curve.segments.length !== 4 ||
    curve.segments.some((segment) => segment.kind !== 'cubic') ||
    !samePoint(curve.start, curve.segments[3]?.end as PagePoint)
  )
    return null
  const endpoints = [curve.start, ...curve.segments.slice(0, 3).map((segment) => segment.end)]
  const bounds = pointBounds(endpoints)
  const center = {
    x: ((bounds.left + bounds.right) * scale.x) / 2,
    y: ((bounds.top + bounds.bottom) * scale.y) / 2,
  }
  const radiusX = ((bounds.right - bounds.left) * scale.x) / 2
  const radiusY = ((bounds.bottom - bounds.top) * scale.y) / 2
  const radius = (radiusX + radiusY) / 2
  if (radius < 2.5 || radius > 25 || Math.abs(radiusX - radiusY) / radius > SHAPE_FIT_RATIO)
    return null
  const raster = (point: PagePoint) => ({ x: point.x * scale.x, y: point.y * scale.y })
  const distance = (a: PagePoint, b: PagePoint) => Math.hypot(a.x - b.x, a.y - b.y)
  const relative = (point: PagePoint) => ({ x: point.x - center.x, y: point.y - center.y })
  const quarterControl = (4 / 3) * Math.tan(Math.PI / 8)
  let start = raster(curve.start)
  let direction = 0
  for (const segment of curve.segments) {
    if (segment.kind !== 'cubic') return null
    const end = raster(segment.end)
    const a = relative(start)
    const b = relative(end)
    const angle = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)
    const sign = Math.sign(angle)
    if (!sign || (direction && sign !== direction)) return null
    direction = sign
    const k = sign * quarterControl
    const expected1 = { x: start.x - k * a.y, y: start.y + k * a.x }
    const expected2 = { x: end.x + k * b.y, y: end.y - k * b.x }
    const residual = Math.max(
      Math.abs(Math.abs(angle) - Math.PI / 2),
      Math.abs(Math.hypot(a.x, a.y) - radius) / radius,
      Math.min(Math.abs(a.x), Math.abs(a.y)) / radius,
      distance(raster(segment.control1), expected1) / radius,
      distance(raster(segment.control2), expected2) / radius,
    )
    if (residual > SHAPE_FIT_RATIO) return null
    start = end
  }
  return bounds
}

/** Number-in-circle source cues. Neither table meanings nor room ownership are inferred. */
export function nativeNumberCircleCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { native, work } = input
  const cues: NativeNumberCircleCue[] = []
  const finish = (reason: string | null) => ({
    status: reason ? ('unresolved' as const) : ('draft' as const),
    basis: 'native-number-in-four-cubic-circle' as const,
    source: { ...native.source },
    originalPdfSha256: native.originalPdfSha256,
    cues: reason ? [] : structuredClone(cues),
    refusalReason: reason,
    shapeFitLimitRatio: SHAPE_FIT_RATIO,
    readOnly: true as const,
    roomOwnershipConfirmed: false as const,
    closesFloorBoundary: false as const,
  })
  try {
    if (nativeFillCandidates(input).refusalReason === 'incomplete-native-layer')
      return finish('incomplete-native-layer')
  } catch {
    return finish('source-frame-unavailable')
  }
  const scale = native.pageNormalizedScale
  if (!scale || work.curvePathsTruncated) return finish('incomplete-native-layer')
  if (work.skippedCurves && !work.curvePaths) return finish('curve-commands-unavailable')
  const curves = work.curvePaths ?? []
  if (
    curves.length > 3000 ||
    curves.length > work.skippedCurves ||
    curves.some((curve) => !Array.isArray(curve.segments) || curve.segments.length > 1000) ||
    curves.reduce((sum, curve) => sum + curve.segments.length * 3 + 1, 0) > 20_000
  )
    return finish('curve-command-limit')
  if (!native.complete || native.labels.length > 1000) return finish('incomplete-native-text')
  const labelIds = new Set<string>()
  for (const label of native.labels) {
    const point = label.pagePoint
    if (
      !Number.isSafeInteger(label.nativeIndex) ||
      (label.nativeIndex ?? -1) < 0 ||
      label.id !== `native-text-${label.nativeIndex}` ||
      labelIds.has(label.id) ||
      !label.name ||
      label.name !== label.name.trim() ||
      label.name.length > 200 ||
      !point ||
      !validPoint(point) ||
      !Number.isFinite(label.rotation) ||
      ![label.point.x, label.point.y].every(Number.isFinite) ||
      Math.abs(label.point.x - point.x * scale.x) > 1e-6 ||
      Math.abs(label.point.y - point.y * scale.y) > 1e-6
    )
      return finish('invalid-native-text-provenance')
    labelIds.add(label.id)
  }
  const refs = new Set<string>()
  const operationCounts = new Map<number, number>()
  for (const path of [...work.paths, ...curves]) {
    const key = pathKey(path)
    if (
      refs.has(key) ||
      ![path.operationIndex, path.subpathIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      typeof path.closed !== 'boolean' ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint)
    )
      return finish('invalid-native-provenance')
    if (!('points' in path)) {
      if (
        !Number.isSafeInteger(path.operationSubpathCount) ||
        path.operationSubpathCount < 1 ||
        path.segments.some((segment) => !['line', 'quadratic', 'cubic'].includes(segment.kind))
      )
        return finish('invalid-native-provenance')
    }
    const points = 'points' in path ? path.points : curvePoints(path)
    if (points.some((point) => !validPoint(point))) return finish('invalid-native-provenance')
    refs.add(key)
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
  }
  const omissions = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    ![work.skippedCurves, work.clippedPaths].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
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
  // A missing curve could be another circle around the same caption. Bounds
  // alone cannot rule that out or establish a unique number observation.
  if (curves.length !== work.skippedCurves) return finish('curve-commands-incomplete')
  const clipped = new Set((work.clippedPathBounds ?? []).map((item) => item.operationIndex))
  let comparisons = 0
  const observations: NativeNumberCircleCue[] = []
  const enclosingCircleCounts = new Map<string, number>()
  for (const curve of curves) {
    if (++comparisons > MAX_WORK) return finish('number-circle-work-limit')
    if (
      curve.operationSubpathCount !== 1 ||
      operationCounts.get(curve.operationIndex) !== 1 ||
      clipped.has(curve.operationIndex)
    )
      continue
    const bounds = circleFit(curve, scale)
    if (!bounds) continue
    const originalBounds = pointBounds(curvePoints(curve))
    const omitted = work.skippedCurveBounds?.filter(
      (item) => item.operationIndex === curve.operationIndex,
    )
    if (
      omitted?.length !== 1 ||
      !Object.entries(originalBounds).every(
        ([key, value]) => omitted[0]?.bounds[key as keyof Bounds] === value,
      )
    )
      continue
    const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
    const inside = native.labels.filter((label) => {
      if (++comparisons > MAX_WORK) return false
      const point = label.pagePoint as PagePoint
      const x = (point.x - center.x) / ((bounds.right - bounds.left) / 2)
      const y = (point.y - center.y) / ((bounds.bottom - bounds.top) / 2)
      return x * x + y * y < 1
    })
    if (comparisons > MAX_WORK) return finish('number-circle-work-limit')
    for (const label of inside)
      enclosingCircleCounts.set(label.id, (enclosingCircleCounts.get(label.id) ?? 0) + 1)
    const label = inside[0]
    if (inside.length !== 1 || !label || label.rotation !== 0 || !/^[1-9]\d{0,3}$/.test(label.name))
      continue
    observations.push({
      labelId: label.id,
      sourceNumber: Number(label.name),
      pagePoint: label.pagePoint as PagePoint,
      bounds,
      curve,
    })
    if (observations.length > MAX_CUES) return finish('number-circle-candidate-limit')
  }
  // No nearest-circle choice when several painted circles enclose the same label.
  // A competing circle stays relevant even if it also encloses a second caption.
  cues.push(...observations.filter((cue) => enclosingCircleCounts.get(cue.labelId) === 1))
  return finish(null)
}
