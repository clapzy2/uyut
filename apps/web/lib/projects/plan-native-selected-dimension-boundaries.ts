import type { PlanPageSegmentRef } from '@uyut/db'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativePaintedFloorBoundarySupports } from './plan-native-painted-floor-boundaries'
import {
  nativePaintedFloorReview,
  type PaintedFloorBoundaryRole,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import {
  type SelectedDimensionEndpointBinding,
  selectedDimensionWitnesses,
} from './plan-native-selected-dimension-witnesses'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'

type Input = Parameters<typeof nativeCaptionBindings>[0] & {
  reviewed: ReviewedNativePaintedFloors
  includeEndpointWitnesses?: boolean
}
type Bindings = ReturnType<typeof nativeCaptionBindings>
export type NativeSelectedDimensionBoundaryReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  physicalBoundariesAccepted: false
  mayTransfer2D: false
  mayTransfer3D: false
  observations: {
    labelId: string
    valueMm: number
    status: 'candidate' | 'ambiguous' | 'unresolved'
    reason: string | null
    candidates: {
      floorId: string
      sourceRoomKey: string
      edgeIndex: number
      ringIndex?: number
      endpointBinding?: SelectedDimensionEndpointBinding
      declaredRole: PaintedFloorBoundaryRole
      span: 'whole-translated-source-vector'
      sourceRefs: PlanPageSegmentRef[]
      boundaryInkComplete: boolean
      boundaryVisibility?: {
        scope: 'literal-selected-edge-segment'
        status: 'unoccluded' | 'held'
        reason: string | null
        sourceRef: PlanPageSegmentRef | null
        blockerOperations: number[]
      }
    }[]
  }[]
}

const MAX_WORK = 2_000_000
const MAX_CANDIDATES = 2000
const MAX_REFS = 20_000
const snapshot = (report: Bindings) =>
  JSON.stringify({
    ...report,
    candidates: [...report.candidates].sort((a, b) => a.labelId.localeCompare(b.labelId)),
    unresolved: [...report.unresolved].sort((a, b) => a.labelId.localeCompare(b.labelId)),
  })

/** Exact equal source vectors propose a selected owner only. They do not prove
 * extension contact, final visibility, a wall/jamb role or a metric floor edge.
 */
export function nativeSelectedDimensionBoundaries(input: Input, suppliedBindings?: Bindings) {
  const observations: NativeSelectedDimensionBoundaryReport['observations'] = []
  const finish = (refusalReason: string | null): NativeSelectedDimensionBoundaryReport => ({
    status: refusalReason ? 'unresolved' : 'draft',
    refusalReason,
    physicalBoundariesAccepted: false,
    mayTransfer2D: false,
    mayTransfer3D: false,
    observations: refusalReason ? [] : structuredClone(observations),
  })
  if (
    suppliedBindings &&
    (!Array.isArray(suppliedBindings.candidates) ||
      !Array.isArray(suppliedBindings.unresolved) ||
      suppliedBindings.candidates.length > 1000 ||
      suppliedBindings.unresolved.length > 1000)
  )
    return finish('selected-dimension-input-limit')
  let bindings: Bindings
  let floors: ReturnType<typeof nativePaintedFloorReview>
  try {
    bindings = nativeCaptionBindings(input)
    if (suppliedBindings && snapshot(suppliedBindings) !== snapshot(bindings))
      return finish('stale-source-caption-bindings')
    if (bindings.status !== 'draft' || bindings.refusalReason)
      return finish(bindings.refusalReason ?? 'source-caption-bindings-unavailable')
    floors = nativePaintedFloorReview(input)
    if (floors.status !== 'reviewed-draft' || floors.refusalReason)
      return finish(floors.refusalReason ?? 'selected-floor-review-unavailable')
  } catch {
    return finish('selected-dimension-source-unavailable')
  }
  let work = MAX_WORK
  let candidateCount = 0
  let refCount = 0
  const exact = nativeFaceRationalPredicates()
  const paint = input.work.paintBounds
  const sourcePaths = new Map(
    input.work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const paintComplete = pdfPaintInventoryIsComplete(paint)
  const exhausted = Symbol('selected-dimension-work-limit')
  const outputLimit = Symbol('selected-dimension-output-limit')
  let supported: ReturnType<typeof nativePaintedFloorBoundarySupports> | undefined
  let endpointWitnesses: ReturnType<typeof selectedDimensionWitnesses> | undefined
  if (input.includeEndpointWitnesses) {
    try {
      supported = nativePaintedFloorBoundarySupports(input)
      if (supported.refusalReason || supported.boundaryInspection.status !== 'checked')
        return finish(supported.refusalReason ?? 'selected-source-boundary-inspection-unavailable')
      endpointWitnesses = selectedDimensionWitnesses(
        input.work,
        () => {
          if (--work < 0) throw exhausted
        },
        (count) => {
          refCount += count
          if (refCount > MAX_REFS) throw outputLimit
        },
      )
    } catch (error) {
      if (error === exhausted) return finish('selected-dimension-work-limit')
      if (error === outputLimit) return finish('selected-dimension-output-limit')
      return finish('selected-dimension-witness-source-unavailable')
    }
  }
  type Candidate =
    NativeSelectedDimensionBoundaryReport['observations'][number]['candidates'][number]
  const boundaryVisibility = (
    edgeStart: string,
    edgeEnd: string,
    sourceRefs: PlanPageSegmentRef[],
  ): Candidate['boundaryVisibility'] => {
    if (!paint) return undefined
    const result: NonNullable<Candidate['boundaryVisibility']> = {
      scope: 'literal-selected-edge-segment',
      status: 'held',
      reason: 'paint-envelope-inventory-unavailable',
      sourceRef: null,
      blockerOperations: [],
    }
    if (!paintComplete) return result
    const literal = sourceRefs.flatMap((ref) => {
      const path = sourcePaths.get(`${ref.operationIndex}:${ref.subpathIndex}`)
      const start = path?.points[ref.segmentIndex]
      const end =
        path?.points[
          path.closed ? (ref.segmentIndex + 1) % path.points.length : ref.segmentIndex + 1
        ]
      if (!start || !end) return []
      const first = exactNativePointKey(start),
        last = exactNativePointKey(end)
      return (first === edgeStart && last === edgeEnd) || (first === edgeEnd && last === edgeStart)
        ? [{ ref, start, end }]
        : []
    })
    if (literal.length !== 1) {
      result.reason = 'selected-segment-source-not-unique'
      return result
    }
    const source = literal[0]
    if (!source) return result
    const own = paint.events.find((event) => event.operationIndex === source.ref.operationIndex)
    if (own?.kind !== 'vector' || own.subpathCount !== 1 || !own.bounds) {
      result.reason = 'selected-segment-paint-provenance-unavailable'
      return result
    }
    result.sourceRef = {
      operationIndex: source.ref.operationIndex,
      subpathIndex: source.ref.subpathIndex,
      segmentIndex: source.ref.segmentIndex,
    }
    // Legacy linework points are rounded to 0.001 normalized page units.
    // This quantization bound is for exclusion only, never a contact/ownership tolerance.
    const quantization = 0.0005
    for (const event of paint.events) {
      if (--work < 0) throw exhausted
      if (event.operationIndex <= source.ref.operationIndex) continue
      if (!pdfPaintMayTouchSpan(event, [source.start, source.end], quantization)) continue
      result.blockerOperations.push(event.operationIndex)
      if (++refCount > MAX_REFS) throw outputLimit
    }
    result.blockerOperations.sort((a, b) => a - b)
    result.status = result.blockerOperations.length ? 'held' : 'unoccluded'
    result.reason = result.blockerOperations.length
      ? 'later-paint-may-cover-selected-segment'
      : null
    return result
  }
  try {
    for (const binding of bindings.candidates) {
      const row: NativeSelectedDimensionBoundaryReport['observations'][number] = {
        labelId: binding.labelId,
        valueMm: binding.valueMm,
        status: 'unresolved',
        reason: 'no-equal-whole-selected-boundary-vector',
        candidates: [],
      }
      observations.push(row)
      const start = exactNativePointKey(binding.spanEnds[0])
      const end = exactNativePointKey(binding.spanEnds[1])
      if (!start || !end || start === end) {
        row.reason = 'source-caption-span-unavailable'
        continue
      }
      for (const floor of floors.floors) {
        const rings = input.includeEndpointWitnesses
          ? [floor.exactPointKeys, ...floor.holeExactPointKeys]
          : [floor.exactPointKeys]
        for (const [ringIndex, ring] of rings.entries()) {
          for (const [edgeIndex, edgeStart] of ring.entries()) {
            if (--work < 0) return finish('selected-dimension-work-limit')
            const edgeEnd = ring[(edgeIndex + 1) % ring.length]
            if (!edgeStart || !edgeEnd || edgeStart === edgeEnd)
              return finish('selected-floor-edge-identity-unavailable')
            const forward = exact.equalSpanVectors(start, end, edgeStart, edgeEnd)
            if (!forward && !exact.equalSpanVectors(start, end, edgeEnd, edgeStart)) continue
            const sourceRefs =
              ringIndex === 0
                ? (floor.edges[edgeIndex]?.sourceRefs ?? [])
                : (supported?.boundaryInspection.floors
                    .find((row) => row.floorId === floor.id)
                    ?.edges.find(
                      (edge) => edge.ringIndex === ringIndex && edge.edgeIndex === edgeIndex,
                    )
                    ?.contacts.map(({ operationIndex, subpathIndex, segmentIndex }) => ({
                      operationIndex,
                      subpathIndex,
                      segmentIndex,
                    })) ?? [])
            const declaredRole =
              ringIndex === 0
                ? (floor.edges[edgeIndex]?.declaredRole ?? 'unresolved')
                : 'unresolved'
            candidateCount++
            refCount += sourceRefs.length
            if (candidateCount > MAX_CANDIDATES || refCount > MAX_REFS)
              return finish('selected-dimension-output-limit')
            const visibility = boundaryVisibility(edgeStart, edgeEnd, sourceRefs)
            row.candidates.push({
              floorId: floor.id,
              sourceRoomKey: floor.owner.sourceRoomKey,
              edgeIndex,
              declaredRole,
              span: 'whole-translated-source-vector',
              sourceRefs: sourceRefs.map(({ operationIndex, subpathIndex, segmentIndex }) => ({
                operationIndex,
                subpathIndex,
                segmentIndex,
              })),
              boundaryInkComplete: floor.boundaryInkComplete,
              ...(endpointWitnesses
                ? {
                    ringIndex,
                    endpointBinding: endpointWitnesses(
                      [start, end],
                      forward ? [edgeStart, edgeEnd] : [edgeEnd, edgeStart],
                    ),
                  }
                : {}),
              ...(visibility ? { boundaryVisibility: visibility } : {}),
            })
          }
        }
      }
      if (row.candidates.length) {
        row.status = row.candidates.length === 1 ? 'candidate' : 'ambiguous'
        row.reason = row.candidates.some((candidate) => !candidate.boundaryInkComplete)
          ? 'incomplete-source-boundary'
          : 'physical-boundary-proof-missing'
      }
    }
  } catch (error) {
    if (error === exhausted) return finish('selected-dimension-work-limit')
    if (error === outputLimit) return finish('selected-dimension-output-limit')
    return finish('selected-dimension-source-unavailable')
  }
  return finish(null)
}
