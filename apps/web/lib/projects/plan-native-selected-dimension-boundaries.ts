import type { PlanPageSegmentRef } from '@uyut/db'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import {
  nativePaintedFloorReview,
  type PaintedFloorBoundaryRole,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'

type Input = Parameters<typeof nativeCaptionBindings>[0] & {
  reviewed: ReviewedNativePaintedFloors
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
      declaredRole: PaintedFloorBoundaryRole
      span: 'whole-translated-source-vector'
      sourceRefs: PlanPageSegmentRef[]
      boundaryInkComplete: boolean
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
        for (const [edgeIndex, edge] of floor.edges.entries()) {
          if (--work < 0) return finish('selected-dimension-work-limit')
          const edgeStart = floor.exactPointKeys[edgeIndex]
          const edgeEnd = floor.exactPointKeys[(edgeIndex + 1) % floor.edges.length]
          if (!edgeStart || !edgeEnd || edgeStart === edgeEnd)
            return finish('selected-floor-edge-identity-unavailable')
          if (
            !exact.equalSpanVectors(start, end, edgeStart, edgeEnd) &&
            !exact.equalSpanVectors(start, end, edgeEnd, edgeStart)
          )
            continue
          candidateCount++
          refCount += edge.sourceRefs.length
          if (candidateCount > MAX_CANDIDATES || refCount > MAX_REFS)
            return finish('selected-dimension-output-limit')
          row.candidates.push({
            floorId: floor.id,
            sourceRoomKey: floor.owner.sourceRoomKey,
            edgeIndex,
            declaredRole: edge.declaredRole,
            span: 'whole-translated-source-vector',
            sourceRefs: edge.sourceRefs.map(({ operationIndex, subpathIndex, segmentIndex }) => ({
              operationIndex,
              subpathIndex,
              segmentIndex,
            })),
            boundaryInkComplete: floor.boundaryInkComplete,
          })
        }
      }
      if (row.candidates.length) {
        row.status = row.candidates.length === 1 ? 'candidate' : 'ambiguous'
        row.reason = row.candidates.some((candidate) => !candidate.boundaryInkComplete)
          ? 'incomplete-source-boundary'
          : 'physical-boundary-proof-missing'
      }
    }
  } catch {
    return finish('selected-dimension-source-unavailable')
  }
  return finish(null)
}
