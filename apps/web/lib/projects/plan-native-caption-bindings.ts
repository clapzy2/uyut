import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import {
  type NativeDimensionCaptionContext,
  nativeDimensionCaptionMillimetres,
} from './plan-pdf-caption-binding'
import {
  pdfNativeDimensionChainIsUnobscured,
  pdfNativeDimensionSourceIssue,
} from './plan-pdf-dimension-source'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { type PdfPlanSource, pdfPointDistance } from './plan-pdf-room-binding'
import {
  createRotatedNativeCaptionVerifier,
  nativeCaptionDimensionAxis,
} from './plan-pdf-rotated-caption'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeCaptionBindingReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  candidates: {
    labelId: string
    compactIndex: number
    valueMm: number
    axis: 'width' | 'depth' | 'aligned'
    angleDegrees?: number
    textPlacement?: 'glyph-ink' | 'baseline'
    inkSourceOperation?: number
    inkSourceOperations?: number[]
    rail: { operationIndex: number; subpathIndex: number }
  }[]
  unresolved: { labelId: string; reason: string }[]
}

const pointValid = (point: PagePoint) =>
  !!point &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)
const angleDifference = (first: number, second: number) => {
  const delta = Math.abs((first - second) % 360)
  return Math.min(delta, 360 - delta)
}
const parallelAngles = (first: number, second: number) => {
  const delta = Math.abs((((first - second) % 180) + 180) % 180)
  return Math.min(delta, 180 - delta) <= 1e-6
}

/** The original run and compact slot are linked by extraction, never by equal text or proximity. */
export function nativeCaptionBindings(input: {
  source: PdfPlanSource
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { source, native, work } = input
  const candidates: (NativeCaptionBindingReport['candidates'][number] & {
    spanEnds: [PagePoint, PagePoint]
  })[] = []
  const unresolved: NativeCaptionBindingReport['unresolved'] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    candidates: refusalReason ? [] : structuredClone(candidates),
    unresolved: refusalReason ? [] : structuredClone(unresolved),
    source: { ...source },
    image: { ...native.source },
    basis: 'original-native-run-to-source-dimension-rail' as const,
    readOnly: true as const,
    mayTransfer2D: false as const,
    mayTransfer3D: false as const,
  })
  const sourceIssue = pdfNativeDimensionSourceIssue(source, work, 'bounded-clipped-ink')
  if (sourceIssue) return finish(sourceIssue)
  if (native.vectorInkRefusal !== undefined) return finish('source-vector-ink-unverified')
  if (
    native.complete !== true ||
    nativeFillCandidates(input).refusalReason === 'incomplete-native-layer' ||
    native.originalPdfSha256 !== source.sha256 ||
    native.source.page !== source.pdfPage
  )
    return finish('unverified-native-caption-source')
  const compact = native.compactCaptionGeometry
  if (!compact) return finish('native-caption-bridge-unavailable')
  if (
    compact.complete !== true ||
    compact.source.sha256 !== source.sha256 ||
    compact.source.pdfPage !== source.pdfPage ||
    compact.source.pageWidth !== work.pageWidth ||
    compact.source.pageHeight !== work.pageHeight ||
    compact.items.length > 1000 ||
    native.labels.length > 1000
  )
    return finish('invalid-native-caption-bridge')
  const scale = native.pageNormalizedScale
  const nativeIds = new Set<string>()
  const compactIds = new Set<number>()
  for (const label of native.labels) {
    if (
      !scale ||
      ![scale.x, scale.y].every((value) => Number.isFinite(value) && value > 0) ||
      !Number.isSafeInteger(label.nativeIndex) ||
      (label.nativeIndex ?? -1) < 0 ||
      label.id !== `native-text-${label.nativeIndex}` ||
      nativeIds.has(label.id) ||
      !Number.isSafeInteger(label.compactIndex) ||
      (label.compactIndex ?? -1) < 0 ||
      (label.compactIndex ?? 1000) >= native.labels.length ||
      compactIds.has(label.compactIndex as number) ||
      !label.name ||
      label.name !== label.name.trim() ||
      label.name.length > 200 ||
      !label.pagePoint ||
      !pointValid(label.pagePoint) ||
      !Number.isFinite(label.rotation) ||
      ![label.point.x, label.point.y].every(Number.isFinite) ||
      Math.abs(label.point.x - label.pagePoint.x * scale.x) > 1e-6 ||
      Math.abs(label.point.y - label.pagePoint.y * scale.y) > 1e-6
    )
      return finish('invalid-native-caption-bridge')
    nativeIds.add(label.id)
    compactIds.add(label.compactIndex as number)
  }
  const labels = native.labels.filter(
    (label) => nativeDimensionCaptionMillimetres(label.name) !== undefined,
  )
  if (
    compact.items.length !== labels.length ||
    new Set(compact.items.map(({ index }) => index)).size !== compact.items.length
  )
    return finish('invalid-native-caption-bridge')
  const byCompactIndex = new Map(compact.items.map((caption) => [caption.index, caption]))
  const context: NativeDimensionCaptionContext = {
    source: { ...compact.source },
    complete: true,
    items: [],
  }
  for (const label of labels) {
    const caption = byCompactIndex.get(label.compactIndex as number)
    const origin = label.pagePoint as PagePoint
    if (
      !caption ||
      !Number.isSafeInteger(caption.index) ||
      caption.text !== label.name ||
      ![caption.origin, caption.baselineStart, caption.baselineEnd].every(pointValid) ||
      !Number.isFinite(caption.rotation) ||
      Math.round(origin.x) !== caption.origin.x ||
      Math.round(origin.y) !== caption.origin.y ||
      // Only transform arithmetic tolerance, not a rounded-origin bucket or glyph snap.
      Math.abs(origin.x - caption.baselineStart.x) > 1e-6 ||
      Math.abs(origin.y - caption.baselineStart.y) > 1e-6
    )
      return finish('invalid-native-caption-bridge')
    const dx = (caption.baselineEnd.x - caption.baselineStart.x) * work.pageWidth
    const dy = (caption.baselineEnd.y - caption.baselineStart.y) * work.pageHeight
    const actualAngle = (-Math.atan2(dy, dx) * 180) / Math.PI
    if (
      (dx === 0 && dy === 0) ||
      angleDifference(actualAngle, label.rotation as number) > 1e-6 ||
      angleDifference(actualAngle, caption.rotation) > 0.5 + 1e-9
    )
      return finish('invalid-native-caption-bridge')
    context.items.push({
      ...structuredClone(caption),
      index: label.nativeIndex as number,
      origin: { ...origin },
      rotation: label.rotation as number,
    })
  }
  // An unavailable outline is not silently discarded as an unknown competitor.
  // This first ink implementation requires the whole numeric glyph inventory.
  if (context.items.some((caption) => caption.inkRefusal !== undefined))
    return finish('source-caption-ink-incomplete')
  const verify = createRotatedNativeCaptionVerifier(work, source, context)
  const nativeCaptions = new Map(context.items.map((item) => [item.index, item]))
  const padX = (6 * 1000) / work.pageWidth
  const padY = (6 * 1000) / work.pageHeight
  const verifiedSpans: {
    labelId: string
    axis: 'width' | 'depth' | 'aligned'
    ends: [PagePoint, PagePoint]
    outboard: boolean
    rotation: number
  }[] = []
  for (const label of labels) {
    const axis = nativeCaptionDimensionAxis(label.rotation as number)
    const valueMm = nativeDimensionCaptionMillimetres(label.name) as number
    const original = {
      index: label.nativeIndex as number,
      text: label.name,
      ...(label.pagePoint as PagePoint),
      rotation: label.rotation as number,
    }
    const chain = verify(original, valueMm)
    if (chain.status !== 'candidate') {
      if (
        [
          'caption-binding-budget-exceeded',
          'dimension-span-budget-exceeded',
          'invalid-native-caption-context',
          'rotated-caption-context-invalid',
          'rotated-caption-budget-exceeded',
        ].includes(chain.reason)
      )
        return finish(chain.reason)
      unresolved.push({ labelId: label.id, reason: chain.reason })
      continue
    }
    if (!pdfNativeDimensionChainIsUnobscured(work, chain, [original])) {
      unresolved.push({ labelId: label.id, reason: 'omitted-ink-near-source-caption-rail' })
      continue
    }
    const [start, end] = chain.ends
    const sourceCaption = nativeCaptions.get(original.index)
    if (!sourceCaption) return finish('invalid-native-caption-bridge')
    const sourcePoints = [
      start,
      end,
      sourceCaption.baselineStart,
      sourceCaption.baselineEnd,
      ...(sourceCaption.inkPolygon ?? []),
    ]
    const bounds = {
      left: Math.min(...sourcePoints.map(({ x }) => x)) - padX,
      right: Math.max(...sourcePoints.map(({ x }) => x)) + padX,
      top: Math.min(...sourcePoints.map(({ y }) => y)) - padY,
      bottom: Math.max(...sourcePoints.map(({ y }) => y)) + padY,
    }
    if (
      [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].some(
        ({ bounds: omitted }) =>
          omitted.right >= bounds.left &&
          omitted.left <= bounds.right &&
          omitted.bottom >= bounds.top &&
          omitted.top <= bounds.bottom,
      )
    ) {
      unresolved.push({ labelId: label.id, reason: 'omitted-ink-near-source-caption-rail' })
      continue
    }
    const otherDirections = context.items.filter((caption) => {
      return !parallelAngles(caption.rotation, sourceCaption.rotation)
    })
    const nearUnsupported = otherDirections.some((caption) => {
      const points = [caption.baselineStart, caption.baselineEnd, ...(caption.inkPolygon ?? [])]
      return (
        Math.max(...points.map(({ x }) => x)) >= bounds.left &&
        Math.min(...points.map(({ x }) => x)) <= bounds.right &&
        Math.max(...points.map(({ y }) => y)) >= bounds.top &&
        Math.min(...points.map(({ y }) => y)) <= bounds.bottom
      )
    })
    if (nearUnsupported) {
      unresolved.push({ labelId: label.id, reason: 'unsupported-caption-near-source-rail' })
      continue
    }
    const rail = chain.linePaths?.[0]
    if (!rail || chain.linePaths?.length !== 1) {
      unresolved.push({ labelId: label.id, reason: 'non-unique-source-caption-rail' })
      continue
    }
    candidates.push({
      labelId: label.id,
      compactIndex: label.compactIndex as number,
      valueMm,
      axis,
      angleDegrees: label.rotation,
      textPlacement: sourceCaption.inkPolygon ? 'glyph-ink' : 'baseline',
      ...(sourceCaption.inkSourceOperation !== undefined
        ? { inkSourceOperation: sourceCaption.inkSourceOperation }
        : {}),
      ...(sourceCaption.inkSourceOperations
        ? { inkSourceOperations: [...sourceCaption.inkSourceOperations] }
        : {}),
      rail: { ...rail },
      spanEnds: structuredClone(chain.ends),
    })
    const dx = ((end.x - start.x) * work.pageWidth) / 1000
    const dy = ((end.y - start.y) * work.pageHeight) / 1000
    const length = Math.hypot(dx, dy)
    const along = (point: PagePoint) =>
      ((((point.x - start.x) * work.pageWidth) / 1000) * dx +
        (((point.y - start.y) * work.pageHeight) / 1000) * dy) /
      length
    const ink = sourceCaption.inkPolygon ?? [sourceCaption.baselineStart, sourceCaption.baselineEnd]
    const positions = ink.map(along)
    const midpoint = (Math.min(...positions) + Math.max(...positions)) / 2
    verifiedSpans.push({
      labelId: label.id,
      axis,
      ends: chain.ends,
      rotation: sourceCaption.rotation,
      outboard: midpoint < 0 || midpoint > length,
    })
  }
  // The existing outboard matcher depends on two independently centred neighbours.
  // A dependent result cannot survive when either witness was held by the ink guards.
  const centred = verifiedSpans.filter((span) => !span.outboard)
  for (const span of verifiedSpans.filter((span) => span.outboard)) {
    const left = centred.filter(
      (other) =>
        other.axis === span.axis &&
        parallelAngles(other.rotation, span.rotation) &&
        other.ends.some((point) => pdfPointDistance(work, point, span.ends[0]) <= 0.12),
    )
    const right = centred.filter(
      (other) =>
        other.axis === span.axis &&
        parallelAngles(other.rotation, span.rotation) &&
        other.ends.some((point) => pdfPointDistance(work, point, span.ends[1]) <= 0.12),
    )
    if (left.length !== 1 || right.length !== 1 || left[0]?.labelId === right[0]?.labelId) {
      const index = candidates.findIndex(({ labelId }) => labelId === span.labelId)
      if (index >= 0) candidates.splice(index, 1)
      unresolved.push({
        labelId: span.labelId,
        reason: 'outboard-caption-reference-witnesses-unverified',
      })
    }
  }
  return finish(null)
}
