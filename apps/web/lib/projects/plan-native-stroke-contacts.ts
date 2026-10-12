import type { PlanPageSegmentRef } from '@uyut/db'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { pdfNativeDimensionSourceIssue } from './plan-pdf-dimension-source'
import type { PagePoint, PdfVectorPath } from './plan-pdf-linework'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'

type Input = Parameters<typeof nativeCaptionBindings>[0]
type Bindings = ReturnType<typeof nativeCaptionBindings>
type Matrix = [number, number, number, number, number, number]
type Tip = {
  endpoint: 0 | 1
  status: 'ink-overlap' | 'held'
  reason: string | null
  sourceRefs: PlanPageSegmentRef[]
  visibility?: {
    status: 'unoccluded' | 'held'
    reason: string | null
    unoccludedSourceRefs: PlanPageSegmentRef[]
    blockerOperations: number[]
  }
}
export type NativeDimensionStrokeContactReport = {
  status: 'diagnostic' | 'unresolved'
  refusalReason: string | null
  observations: {
    labelId: string
    valueMm: number
    rail: { operationIndex: number; subpathIndex: number }
    tips: [Tip, Tip]
  }[]
  visibility: 'not-checked' | 'checked'
  physicalTargetsAccepted: false
  mayTransfer2D: false
  mayTransfer3D: false
}

const MAX_WORK = 2_000_000
const MAX_REFS = 20_000
const ROUNDING_FACTOR = 64 * Number.EPSILON
const finitePoint = (point: PagePoint) =>
  !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
const rounded = (value: number) => Math.round(value * 1000) / 1000
const map = (point: PagePoint, matrix: Matrix): PagePoint => ({
  x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
  y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
})

function snapshot(bindings: Bindings) {
  return JSON.stringify({
    ...bindings,
    candidates: [...bindings.candidates].sort((a, b) => a.labelId.localeCompare(b.labelId)),
    unresolved: [...bindings.unresolved].sort((a, b) => a.labelId.localeCompare(b.labelId)),
  })
}

/** This proves membership only in the PDF.js solid straight-stroke model.
 * Original decimal operands, final paint visibility and physical ownership are not proved.
 */
function sourceInk(path: PdfVectorPath) {
  const ink = path.strokeInk
  if (!ink) return { reason: 'source-stroke-ink-unavailable' as const }
  if (ink.refusalReason) return { reason: ink.refusalReason }
  if (
    path.closed ||
    path.paint !== 'stroke' ||
    path.points.length !== 2 ||
    !Array.isArray(ink.points) ||
    ink.points.length !== 2 ||
    !ink.points.every(finitePoint) ||
    !Array.isArray(ink.sourceToPage) ||
    ink.sourceToPage.length !== 6 ||
    !ink.sourceToPage.every(Number.isFinite) ||
    !Number.isFinite(ink.lineWidth) ||
    ink.lineWidth <= 0 ||
    ![0, 1, 2].includes(ink.lineCap) ||
    ![0, 1, 2].includes(ink.lineJoin) ||
    !Number.isFinite(ink.miterLimit) ||
    ink.miterLimit <= 0 ||
    !Array.isArray(ink.dashArray) ||
    ink.dashArray.length !== 0 ||
    !Number.isFinite(ink.dashPhase) ||
    !/^#[0-9a-f]{6}$/i.test(path.strokeColor ?? '') ||
    path.strokeColor?.toLowerCase() === '#ffffff'
  )
    return { reason: 'unsupported-source-stroke-ink' as const }
  const matrix = ink.sourceToPage
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  const determinantError =
    ROUNDING_FACTOR * (Math.abs(matrix[0] * matrix[3]) + Math.abs(matrix[1] * matrix[2]))
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= determinantError)
    return { reason: 'unstable-source-stroke-transform' as const }
  const inverse = [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
  ] as const
  if (!inverse.every(Number.isFinite))
    return { reason: 'unstable-source-stroke-transform' as const }
  const points = ink.points.map((point) => map(point, matrix))
  if (
    points.some(
      (point, index) =>
        !finitePoint(point) ||
        rounded(point.x) !== path.points[index]?.x ||
        rounded(point.y) !== path.points[index]?.y,
    )
  )
    return { reason: 'source-stroke-geometry-mismatch' as const }
  return { ink, matrix, inverse, points, reason: null }
}

function strictlyInside(tip: PagePoint, tipError: number, witness: ReturnType<typeof sourceInk>) {
  if (!witness.ink || !witness.matrix || !witness.inverse) return false
  const { ink, matrix, inverse } = witness
  const x = tip.x - matrix[4]
  const y = tip.y - matrix[5]
  const local = { x: inverse[0] * x + inverse[2] * y, y: inverse[1] * x + inverse[3] * y }
  const start = ink.points[0]
  const end = ink.points[1]
  if (!start || !end || !finitePoint(local)) return false
  // Bounds absorb floating arithmetic only. They do not enlarge the painted strip.
  // Near any boundary we refuse rather than snapping or accepting an epsilon contact.
  const inputError =
    tipError +
    ROUNDING_FACTOR *
      (Math.abs(tip.x) + Math.abs(tip.y) + Math.abs(matrix[4]) + Math.abs(matrix[5]))
  const localError =
    inputError * inverse.reduce((sum, value) => sum + Math.abs(value), 0) +
    ROUNDING_FACTOR *
      (Math.abs(local.x) +
        Math.abs(local.y) +
        Math.abs(start.x) +
        Math.abs(start.y) +
        Math.abs(end.x) +
        Math.abs(end.y))
  const dx = end.x - start.x
  const dy = end.y - start.y
  const px = local.x - start.x
  const py = local.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const along = px * dx + py * dy
  const cross = px * dy - py * dx
  const radius = ink.lineWidth / 2
  const interiorLimit = radius * radius * lengthSquared
  const crossSquared = cross * cross
  const directionSize = Math.abs(dx) + Math.abs(dy)
  const alongError =
    localError * directionSize +
    ROUNDING_FACTOR * (Math.abs(px * dx) + Math.abs(py * dy) + lengthSquared)
  const crossError =
    localError * directionSize + ROUNDING_FACTOR * (Math.abs(px * dy) + Math.abs(py * dx))
  const distanceError =
    2 * Math.abs(cross) * crossError +
    crossError * crossError +
    ROUNDING_FACTOR * (Math.abs(interiorLimit) + crossSquared)
  return (
    [lengthSquared, along, cross, interiorLimit, crossSquared, alongError, distanceError].every(
      Number.isFinite,
    ) &&
    lengthSquared > 0 &&
    along > alongError &&
    lengthSquared - along > alongError &&
    interiorLimit - crossSquared > distanceError
  )
}

/** Source-ink observations never replace exact dimension targets or authorize transfer. */
export function nativeDimensionStrokeContacts(
  input: Input,
  suppliedBindings?: Bindings,
): NativeDimensionStrokeContactReport {
  const observations: NativeDimensionStrokeContactReport['observations'] = []
  const paint = input.work.paintBounds
  const finish = (refusalReason: string | null): NativeDimensionStrokeContactReport => ({
    status: refusalReason ? 'unresolved' : 'diagnostic',
    refusalReason,
    observations: refusalReason ? [] : structuredClone(observations),
    visibility: paint ? 'checked' : 'not-checked',
    physicalTargetsAccepted: false,
    mayTransfer2D: false,
    mayTransfer3D: false,
  })
  const issue = pdfNativeDimensionSourceIssue(input.source, input.work, 'bounded-clipped-ink')
  if (issue) return finish(issue)
  if (input.native.vectorInkRefusal !== undefined) return finish('source-vector-ink-unverified')
  if (
    input.native.labels.length > 1000 ||
    (suppliedBindings &&
      (!Array.isArray(suppliedBindings.candidates) ||
        !Array.isArray(suppliedBindings.unresolved) ||
        suppliedBindings.candidates.length > 1000 ||
        suppliedBindings.unresolved.length > 1000))
  )
    return finish('stroke-contact-input-limit')
  let fresh: Bindings
  try {
    fresh = nativeCaptionBindings(input)
    if (suppliedBindings && snapshot(suppliedBindings) !== snapshot(fresh))
      return finish('stale-source-caption-bindings')
  } catch {
    return finish('source-caption-bindings-unavailable')
  }
  if (fresh.status !== 'draft' || fresh.refusalReason)
    return finish(fresh.refusalReason ?? 'source-caption-bindings-unavailable')
  if (fresh.candidates.length > 1000) return finish('stroke-contact-input-limit')
  let budget = MAX_WORK
  let refCount = 0
  const witnesses = input.work.paths
    .filter((path) => path.paint === 'stroke' && !path.closed && path.points.length === 2)
    .map((path) => ({ path, source: sourceInk(path) }))
  const byRef = new Map(
    witnesses.map((item) => [`${item.path.operationIndex}:${item.path.subpathIndex}`, item.path]),
  )
  const paintValid = pdfPaintInventoryIsComplete(paint)
  const paintByOperation = new Map(
    paintValid ? paint?.events.map((event) => [event.operationIndex, event]) : [],
  )
  let visibilityRefs = 0
  const inspectVisibility = (
    tip: Tip,
    point: PagePoint | undefined,
    error: number,
    rail: PdfVectorPath | undefined,
  ) => {
    if (!paint) return true
    tip.visibility = {
      status: 'held',
      reason: 'no-source-ink-contact',
      unoccludedSourceRefs: [],
      blockerOperations: [],
    }
    if (!tip.sourceRefs.length || !point || !rail) return true
    if (!paintValid) {
      tip.visibility.reason = 'paint-envelope-inventory-unavailable'
      return true
    }
    const blockers = new Set<number>()
    for (const ref of tip.sourceRefs) {
      const witness = byRef.get(`${ref.operationIndex}:${ref.subpathIndex}`)
      const own = paintByOperation.get(rail.operationIndex)
      const other = paintByOperation.get(ref.operationIndex)
      if (
        !witness ||
        !own ||
        !other ||
        own.kind !== 'vector' ||
        other.kind !== 'vector' ||
        own.subpathCount !== 1 ||
        other.subpathCount !== 1 ||
        own.bounds === null ||
        other.bounds === null ||
        rail.strokeColor !== witness.strokeColor
      ) {
        tip.visibility.reason = 'contact-paint-provenance-unavailable'
        continue
      }
      let held = false
      for (const event of paint.events) {
        if (--budget < 0) return false
        // The pair forms the shared ink contact; no other operation (even of
        // the same colour or among alternative witnesses) is exempted.
        if (
          event.operationIndex <= Math.min(rail.operationIndex, ref.operationIndex) ||
          event.operationIndex === rail.operationIndex ||
          event.operationIndex === ref.operationIndex
        )
          continue
        if (!pdfPaintMayTouchSpan(event, [point, point], error)) continue
        held = true
        blockers.add(event.operationIndex)
      }
      if (!held) tip.visibility.unoccludedSourceRefs.push({ ...ref })
    }
    tip.visibility.blockerOperations = [...blockers].sort((a, b) => a - b)
    visibilityRefs +=
      tip.visibility.blockerOperations.length + tip.visibility.unoccludedSourceRefs.length
    if (visibilityRefs > MAX_REFS) return false
    if (tip.visibility.unoccludedSourceRefs.length) {
      tip.visibility.status = 'unoccluded'
      tip.visibility.reason = null
    } else if (blockers.size) tip.visibility.reason = 'later-paint-may-cover-contact'
    return true
  }
  for (const candidate of fresh.candidates) {
    const rail = input.work.paths.find(
      (path) =>
        path.operationIndex === candidate.rail.operationIndex &&
        path.subpathIndex === candidate.rail.subpathIndex,
    )
    const source = rail ? sourceInk(rail) : null
    const samePoint = (a: PagePoint | undefined, b: PagePoint | undefined) =>
      !!a && !!b && a.x === b.x && a.y === b.y
    const forward =
      rail &&
      samePoint(candidate.spanEnds[0], rail.points[0]) &&
      samePoint(candidate.spanEnds[1], rail.points[1])
    const reverse =
      rail &&
      samePoint(candidate.spanEnds[0], rail.points[1]) &&
      samePoint(candidate.spanEnds[1], rail.points[0])
    const spanMismatch = !forward && !reverse
    const tips: [Tip, Tip] = [0, 1].map(
      (endpoint): Tip => ({
        endpoint: endpoint as 0 | 1,
        status: 'held',
        reason: spanMismatch
          ? 'source-caption-rail-span-mismatch'
          : (source?.reason ??
            (rail
              ? 'no-strict-source-stroke-interior-contact'
              : 'source-caption-rail-unavailable')),
        sourceRefs: [],
      }),
    ) as [Tip, Tip]
    observations.push({
      labelId: candidate.labelId,
      valueMm: candidate.valueMm,
      rail: { ...candidate.rail },
      tips,
    })
    if (!source?.points || !source.ink || !source.matrix || source.reason || spanMismatch) {
      for (const tip of tips) inspectVisibility(tip, undefined, 0, rail)
      continue
    }
    for (const tip of tips) {
      const sourceEndpoint = reverse ? 1 - tip.endpoint : tip.endpoint
      const point = source.points[sourceEndpoint]
      const raw = source.ink.points[sourceEndpoint]
      if (!point || !raw) continue
      const m = source.matrix
      const tipError =
        ROUNDING_FACTOR *
        (Math.abs(m[0] * raw.x) +
          Math.abs(m[2] * raw.y) +
          Math.abs(m[4]) +
          Math.abs(m[1] * raw.x) +
          Math.abs(m[3] * raw.y) +
          Math.abs(m[5]))
      for (const witness of witnesses) {
        if (--budget < 0) return finish('stroke-contact-work-limit')
        if (witness.path.operationIndex === rail?.operationIndex) continue
        if (!strictlyInside(point, tipError, witness.source)) continue
        if (++refCount > MAX_REFS) return finish('stroke-contact-output-limit')
        tip.sourceRefs.push({
          operationIndex: witness.path.operationIndex,
          subpathIndex: witness.path.subpathIndex,
          segmentIndex: 0,
        })
      }
      tip.sourceRefs.sort(
        (a, b) => a.operationIndex - b.operationIndex || a.subpathIndex - b.subpathIndex,
      )
      if (tip.sourceRefs.length) {
        tip.status = 'ink-overlap'
        tip.reason = null
      }
      if (!inspectVisibility(tip, point, tipError, rail))
        return finish('stroke-contact-work-or-output-limit')
    }
  }
  return finish(null)
}
