import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { pdfNativeDimensionSourceIssue } from './plan-pdf-dimension-source'
import type { PagePoint } from './plan-pdf-linework'

type Input = Parameters<typeof nativeCaptionBindings>[0]
type Bindings = ReturnType<typeof nativeCaptionBindings>
type Axis = 'width' | 'depth'
type ScaleStatus = 'consistent' | 'insufficient' | 'conflict'
type Observation = {
  labelId: string
  valueMm: number
  lengthPoints: number
  mmPerPoint: number
  residualMm: number
}
export type NativeScaleEvidenceReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  /** Printed drawing consistency only, never endpoint movement or field-measurement accuracy. */
  dimensionToleranceMm: 2
  axes: {
    axis: Axis
    status: ScaleStatus
    referenceLabelId: string | null
    referenceMmPerPoint: number | null
    independentLabelIds: string[]
    observations: Observation[]
  }[]
  commonScale: {
    status: ScaleStatus
    referenceLabelId: string | null
    mmPerPoint: number | null
  }
  unresolved: { labelId: string; reason: string }[]
}

const MAX_OBSERVATIONS = 1000
const DIMENSION_TOLERANCE_MM = 2
const pointKey = (point: PagePoint) => `${point.x}:${point.y}`
const validPoint = (point: PagePoint) =>
  point &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

function bindingSnapshot(bindings: Bindings) {
  return JSON.stringify({
    ...bindings,
    candidates: [...bindings.candidates].sort((a, b) => a.labelId.localeCompare(b.labelId)),
    unresolved: [...bindings.unresolved].sort((a, b) => a.labelId.localeCompare(b.labelId)),
  })
}

/** Nominal source drawing scale only. No room owner, floor conversion or anisotropic fitting. */
export function nativeScaleEvidence(input: Input, suppliedBindings?: Bindings) {
  const axes: NativeScaleEvidenceReport['axes'] = (['width', 'depth'] as const).map((axis) => ({
    axis,
    status: 'insufficient',
    referenceLabelId: null,
    referenceMmPerPoint: null,
    independentLabelIds: [],
    observations: [],
  }))
  const unresolved: NativeScaleEvidenceReport['unresolved'] = []
  let commonScale: NativeScaleEvidenceReport['commonScale'] = {
    status: 'insufficient',
    referenceLabelId: null,
    mmPerPoint: null,
  }
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    dimensionToleranceMm: 2 as const,
    axes: refusalReason ? [] : structuredClone(axes),
    commonScale: refusalReason
      ? { status: 'insufficient' as const, referenceLabelId: null, mmPerPoint: null }
      : { ...commonScale },
    unresolved: refusalReason ? [] : structuredClone(unresolved),
    source: { ...input.source },
    image: { ...input.native.source },
    basis: 'independent-source-dimension-scale-evidence' as const,
    readOnly: true as const,
    mayTransfer2D: false as const,
    mayTransfer3D: false as const,
  })
  const sourceIssue = pdfNativeDimensionSourceIssue(input.source, input.work, 'bounded-clipped-ink')
  if (sourceIssue) return finish(sourceIssue)
  if (
    input.native.labels.length > MAX_OBSERVATIONS ||
    (suppliedBindings &&
      (!Array.isArray(suppliedBindings.candidates) ||
        !Array.isArray(suppliedBindings.unresolved) ||
        suppliedBindings.candidates.length > MAX_OBSERVATIONS ||
        suppliedBindings.unresolved.length > MAX_OBSERVATIONS))
  )
    return finish('scale-evidence-input-limit')
  let fresh: Bindings
  try {
    fresh = nativeCaptionBindings(input)
    if (suppliedBindings && bindingSnapshot(suppliedBindings) !== bindingSnapshot(fresh))
      return finish('stale-source-caption-bindings')
  } catch {
    return finish('source-caption-bindings-unavailable')
  }
  if (fresh.status !== 'draft' || fresh.refusalReason)
    return finish(fresh.refusalReason ?? 'source-caption-bindings-unavailable')
  if (fresh.candidates.length + fresh.unresolved.length > MAX_OBSERVATIONS)
    return finish('scale-evidence-input-limit')

  type Span = Omit<Observation, 'residualMm'> & {
    axis: Axis
    ends: [PagePoint, PagePoint]
    low: number
    high: number
    railKey: string
  }
  const spans: Span[] = []
  for (const candidate of fresh.candidates) {
    if (candidate.axis === 'aligned') {
      unresolved.push({
        labelId: candidate.labelId,
        reason: 'scale-evidence-noncardinal-dimension',
      })
      continue
    }
    const [start, end] = candidate.spanEnds
    const angle = candidate.angleDegrees
    const cardinalAngle = angle === undefined ? undefined : ((angle % 180) + 180) % 180
    const expectedAngle = candidate.axis === 'width' ? 0 : 90
    const angleError =
      cardinalAngle === undefined ? Infinity : Math.abs(cardinalAngle - expectedAngle)
    if (
      !validPoint(start) ||
      !validPoint(end) ||
      !Number.isFinite(angle) ||
      Math.min(angleError, 180 - angleError) > 1e-6 ||
      (candidate.axis === 'width' ? start.y !== end.y : start.x !== end.x) ||
      !Number.isSafeInteger(candidate.valueMm) ||
      candidate.valueMm <= 0
    )
      return finish('invalid-source-cardinal-scale-span')
    const lengthPoints = Math.hypot(
      ((end.x - start.x) * input.work.pageWidth) / 1000,
      ((end.y - start.y) * input.work.pageHeight) / 1000,
    )
    const mmPerPoint = candidate.valueMm / lengthPoints
    if (!Number.isFinite(mmPerPoint) || lengthPoints <= 0 || mmPerPoint <= 0)
      return finish('invalid-source-cardinal-scale-span')
    const along = candidate.axis === 'width' ? 'x' : 'y'
    spans.push({
      labelId: candidate.labelId,
      valueMm: candidate.valueMm,
      axis: candidate.axis,
      ends: [start, end],
      low: Math.min(start[along], end[along]),
      high: Math.max(start[along], end[along]),
      railKey: `${candidate.rail.operationIndex}:${candidate.rail.subpathIndex}`,
      lengthPoints,
      mmPerPoint,
    })
  }
  unresolved.push(...fresh.unresolved.map(({ labelId, reason }) => ({ labelId, reason })))
  spans.sort((a, b) => b.lengthPoints - a.lengthPoints || a.labelId.localeCompare(b.labelId))
  for (const axis of axes) {
    const local = spans.filter((span) => span.axis === axis.axis)
    const reference = local[0]
    if (!reference) continue
    axis.referenceLabelId = reference.labelId
    axis.referenceMmPerPoint = reference.mmPerPoint
    // Repeated dimension rows, totals and their overlapping chain parts cannot
    // supply an independent second measurement. No interval is snapped or fitted.
    // The longest reference may cover both independent shorter dimensions.
    // Search all pairs in stable reference order; 1000 observations bound this
    // to fewer than 500000 comparisons. All observations still undergo checks.
    let independent: Span[] = []
    for (let index = 0; index < local.length && independent.length === 0; index++) {
      const first = local[index]
      if (!first) continue
      for (const second of local.slice(index + 1)) {
        if (
          first.labelId !== second.labelId &&
          first.railKey !== second.railKey &&
          (first.high < second.low || first.low > second.high) &&
          first.ends.every((point) =>
            second.ends.every((other) => pointKey(point) !== pointKey(other)),
          )
        ) {
          independent = [first, second]
          break
        }
      }
    }
    axis.independentLabelIds = independent.map((span) => span.labelId)
    axis.observations = local.map((span) => ({
      labelId: span.labelId,
      valueMm: span.valueMm,
      lengthPoints: span.lengthPoints,
      mmPerPoint: span.mmPerPoint,
      residualMm: span.lengthPoints * reference.mmPerPoint - span.valueMm,
    }))
    axis.status = axis.observations.some(
      (span) => Math.abs(span.residualMm) > DIMENSION_TOLERANCE_MM,
    )
      ? 'conflict'
      : independent.length === 2
        ? 'consistent'
        : 'insufficient'
  }
  const xReference = spans.find((span) => span.axis === 'width')
  const crossConflict =
    xReference &&
    spans.some(
      (span) =>
        Math.abs(span.lengthPoints * xReference.mmPerPoint - span.valueMm) > DIMENSION_TOLERANCE_MM,
    )
  if (axes.some((axis) => axis.status === 'conflict') || crossConflict) {
    commonScale = { status: 'conflict', referenceLabelId: null, mmPerPoint: null }
  } else if (axes.every((axis) => axis.status === 'consistent') && xReference) {
    commonScale = {
      status: 'consistent',
      referenceLabelId: xReference.labelId,
      mmPerPoint: xReference.mmPerPoint,
    }
  }
  return finish(null)
}
