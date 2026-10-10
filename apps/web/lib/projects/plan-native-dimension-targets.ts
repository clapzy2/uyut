import type { PlanPageSegmentRef } from '@uyut/db'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { exactNativeOrientation } from './plan-native-exact-intersections'
import { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import { nativeOpeningFrameCandidates } from './plan-native-opening-frames'
import { pdfNativeDimensionSourceIssue } from './plan-pdf-dimension-source'
import type { PagePoint } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'

type Input = Parameters<typeof nativeCaptionBindings>[0]
type Bindings = ReturnType<typeof nativeCaptionBindings>
type Ref = PlanPageSegmentRef
type Status = 'continuous' | 'detached' | 'ambiguous' | 'unresolved'
type EndpointWitness = {
  status: Status
  sourceRefs: Ref[]
  /** Literal PDF-point separation, not an allowed bridge or installation tolerance. */
  gapPoints: number | null
}
type FaceObservation = {
  edgeIndex: number
  status: Status
  reason: string | null
  supportRefs: Ref[]
  endpointWitnesses: [EndpointWitness, EndpointWitness]
}
type TargetObservation = {
  kind: 'floor-boundary' | 'opening-frame'
  id: string
  faces: FaceObservation[]
}
export type NativeDimensionTargetReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  observations: {
    labelId: string
    valueMm: number
    axis: 'width' | 'depth' | 'aligned'
    status: Status
    reason: string | null
    targets: TargetObservation[]
  }[]
  unresolved: { labelId: string; reason: string }[]
}

const MAX_WORK = 2_000_000
const MAX_FACES = 4200
const MAX_OBSERVATIONS = 1000
const MAX_REFS = 20_000
const refKey = (ref: Ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
const asRef = ({ operationIndex, subpathIndex, segmentIndex }: Ref): Ref => ({
  operationIndex,
  subpathIndex,
  segmentIndex,
})
const orderedRefs = (refs: Ref[]) =>
  [...new Map(refs.map((ref) => [refKey(ref), asRef(ref)])).values()].sort(
    (a, b) =>
      a.operationIndex - b.operationIndex ||
      a.subpathIndex - b.subpathIndex ||
      a.segmentIndex - b.segmentIndex,
  )
const pointKey = (point: PagePoint) => `${point.x}:${point.y}`
const spanKey = (segment: NativePageSegment) =>
  [pointKey(segment.start), pointKey(segment.end)].sort().join('|')
const within = (value: number, first: number, last: number) =>
  value >= Math.min(first, last) && value <= Math.max(first, last)
const validPoint = (point: PagePoint | undefined): point is PagePoint =>
  !!point &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

function bindingSnapshot(bindings: Bindings) {
  return JSON.stringify({
    status: bindings.status,
    refusalReason: bindings.refusalReason,
    source: bindings.source,
    image: bindings.image,
    basis: bindings.basis,
    readOnly: bindings.readOnly,
    mayTransfer2D: bindings.mayTransfer2D,
    mayTransfer3D: bindings.mayTransfer3D,
    candidates: [...bindings.candidates].sort((a, b) => a.labelId.localeCompare(b.labelId)),
    unresolved: [...bindings.unresolved].sort((a, b) => a.labelId.localeCompare(b.labelId)),
  })
}

/** Source associations only. Detached drafting extensions never close a floor or prove a passage. */
export function nativeDimensionTargets(input: Input, suppliedBindings?: Bindings) {
  const observations: NativeDimensionTargetReport['observations'] = []
  const unresolved: NativeDimensionTargetReport['unresolved'] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    observations: refusalReason ? [] : structuredClone(observations),
    unresolved: refusalReason ? [] : structuredClone(unresolved),
    source: { ...input.source },
    image: { ...input.native.source },
    basis: 'source-caption-to-whole-boundary-and-jamb-observations' as const,
    readOnly: true as const,
    roomOwnershipConfirmed: false as const,
    physicalPassagesAccepted: false as const,
    mayTransfer2D: false as const,
    mayTransfer3D: false as const,
  })
  const issue = pdfNativeDimensionSourceIssue(input.source, input.work)
  if (issue) return finish(issue)
  if (
    input.native.labels.length > 1000 ||
    (suppliedBindings &&
      (!Array.isArray(suppliedBindings.candidates) ||
        !Array.isArray(suppliedBindings.unresolved) ||
        suppliedBindings.candidates.length > 1000 ||
        suppliedBindings.unresolved.length > 1000))
  )
    return finish('dimension-target-input-limit')
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
  unresolved.push(...fresh.unresolved.map(({ labelId, reason }) => ({ labelId, reason })))
  if (!fresh.candidates.length) return finish(null)

  let budget = MAX_WORK
  const exhausted = Symbol('dimension-target-work-limit')
  const spend = (count = 1) => {
    budget -= count
    if (budget < 0) throw exhausted
  }
  type SourceFace = {
    kind: TargetObservation['kind']
    id: string
    edgeIndex: number
    start: PagePoint
    end: PagePoint
    supports: NativePageSegment[]
    omitted: boolean
  }
  const faces: SourceFace[] = []
  try {
    const floor = nativeFloorCavityCandidates(input)
    const frames = nativeOpeningFrameCandidates(input)
    if (floor.refusalReason || frames.refusalReason)
      return finish(floor.refusalReason ?? frames.refusalReason ?? 'source-targets-unavailable')
    for (const cell of floor.cavities) {
      for (const [edgeIndex, boundary] of cell.boundaries.entries()) {
        spend(boundary.supports.length + 1)
        if (faces.length >= MAX_FACES) return finish('dimension-target-input-limit')
        faces.push({
          kind: 'floor-boundary',
          id: cell.id,
          edgeIndex,
          start: boundary.start,
          end: boundary.end,
          supports: boundary.supports.map(({ edge }) => edge),
          omitted: cell.omittedBoundaryInkCount > 0,
        })
      }
    }
    for (const frame of frames.candidates) {
      for (const face of frame.longEdges) {
        spend(frame.jambs.reduce((count, jamb) => count + jamb.sourceEdges.length, 1) + 1)
        if (faces.length >= MAX_FACES) return finish('dimension-target-input-limit')
        faces.push({
          kind: 'opening-frame',
          id: frame.id,
          edgeIndex: face.segmentIndex,
          start: face.start,
          end: face.end,
          supports: [face, ...frame.jambs.flatMap(({ sourceEdges }) => sourceEdges)],
          omitted: frame.unresolvedInk.length > 0,
        })
      }
    }
  } catch (error) {
    return finish(
      error === exhausted ? 'dimension-target-work-limit' : 'source-targets-unavailable',
    )
  }
  if (faces.length > MAX_FACES) return finish('dimension-target-input-limit')
  const segments = nativePageSegments(input.work)
  const paths = new Map(
    input.work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const perpendicular = new Map<string, NativePageSegment[]>()
  for (const segment of segments) {
    const axis =
      segment.start.x === segment.end.x ? 'x' : segment.start.y === segment.end.y ? 'y' : null
    if (!axis) continue
    const key = `${axis}:${segment.start[axis]}`
    const entries = perpendicular.get(key) ?? []
    entries.push(segment)
    perpendicular.set(key, entries)
  }
  let outputRefs = 0
  const sourceRefs = (items: NativePageSegment[]) => {
    const refs = orderedRefs(items)
    outputRefs += refs.length
    if (outputRefs > MAX_REFS) throw exhausted
    return refs
  }
  const witness = (tip: PagePoint, corner: PagePoint, along: 'x' | 'y'): EndpointWitness => {
    const across = along === 'x' ? 'y' : 'x'
    const candidates = perpendicular.get(`${along}:${tip[along]}`) ?? []
    const continuous: NativePageSegment[] = []
    const detached: NativePageSegment[] = []
    for (const segment of candidates) {
      spend()
      if (!within(tip[across], segment.start[across], segment.end[across])) continue
      if (within(corner[across], segment.start[across], segment.end[across])) {
        continuous.push(segment)
        continue
      }
      const path = paths.get(`${segment.operationIndex}:${segment.subpathIndex}`)
      if (path?.paint !== 'stroke' || path.closed || path.points.length !== 2) continue
      const endpoint =
        corner[across] > tip[across]
          ? Math.max(segment.start[across], segment.end[across])
          : Math.min(segment.start[across], segment.end[across])
      if ((endpoint - tip[across]) * (corner[across] - tip[across]) > 0) detached.push(segment)
    }
    // A continuous extension cannot hide a differently bounded, detached stroke.
    // Only exact repaints share a witness group; neither nearest nor longest wins.
    const matches = [...continuous, ...detached]
    const groups = new Set(matches.map(spanKey))
    if (!groups.size) return { status: 'unresolved', sourceRefs: [], gapPoints: null }
    if (groups.size > 1)
      return { status: 'ambiguous', sourceRefs: sourceRefs(matches), gapPoints: null }
    if (continuous.length)
      return { status: 'continuous', sourceRefs: sourceRefs(continuous), gapPoints: 0 }
    const segment = detached[0] as NativePageSegment
    const endpoint =
      corner[across] > tip[across]
        ? Math.max(segment.start[across], segment.end[across])
        : Math.min(segment.start[across], segment.end[across])
    const pageLength = across === 'x' ? input.work.pageWidth : input.work.pageHeight
    return {
      status: 'detached',
      sourceRefs: sourceRefs(detached),
      gapPoints: (Math.abs(endpoint - corner[across]) * pageLength) / 1000,
    }
  }
  try {
    for (const binding of [...fresh.candidates].sort((a, b) =>
      a.labelId.localeCompare(b.labelId),
    )) {
      spend()
      const row: NativeDimensionTargetReport['observations'][number] = {
        labelId: binding.labelId,
        valueMm: binding.valueMm,
        axis: binding.axis,
        status: 'unresolved',
        reason: 'no-exact-whole-source-target',
        targets: [],
      }
      observations.push(row)
      if (observations.length > MAX_OBSERVATIONS) throw exhausted
      if (binding.axis !== 'width' && binding.axis !== 'depth') {
        row.reason = 'non-cardinal-source-target-not-supported'
        continue
      }
      const span = binding.spanEnds
      if (span?.length !== 2 || !span.every(validPoint)) {
        row.reason = 'source-caption-span-unavailable'
        continue
      }
      const along = binding.axis === 'width' ? 'x' : 'y'
      const across = along === 'x' ? 'y' : 'x'
      const tips = [...span].sort((a, b) => a[along] - b[along]) as [PagePoint, PagePoint]
      if (tips[0][along] === tips[1][along] || tips[0][across] !== tips[1][across]) {
        row.reason = 'unsupported-source-caption-span'
        continue
      }
      for (const face of faces) {
        spend()
        const corners = [face.start, face.end].sort((a, b) => a[along] - b[along]) as [
          PagePoint,
          PagePoint,
        ]
        if (
          corners[0][along] !== tips[0][along] ||
          corners[1][along] !== tips[1][along] ||
          corners[0][across] !== corners[1][across] ||
          corners[0][across] === tips[0][across]
        )
          continue
        // The fresh cavity already re-proved complete literal support coverage. Its
        // logical frame/profile supports remain logical; they do not become wall faces.
        spend(face.supports.length)
        if (
          !face.supports.length ||
          (face.kind === 'floor-boundary' &&
            face.supports.some(
              (support) =>
                exactNativeOrientation(face.start, face.end, support.start) !== 0 ||
                exactNativeOrientation(face.start, face.end, support.end) !== 0,
            ))
        )
          continue
        const endpointWitnesses: [EndpointWitness, EndpointWitness] = [
          witness(tips[0], corners[0], along),
          witness(tips[1], corners[1], along),
        ]
        const padX = (6 * 1000) / input.work.pageWidth
        const padY = (6 * 1000) / input.work.pageHeight
        const points = [...tips, ...corners]
        const omitted =
          face.omitted ||
          (input.work.skippedCurveBounds ?? []).some(({ bounds }) => {
            spend()
            return (
              bounds.right >= Math.min(...points.map(({ x }) => x)) - padX &&
              bounds.left <= Math.max(...points.map(({ x }) => x)) + padX &&
              bounds.bottom >= Math.min(...points.map(({ y }) => y)) - padY &&
              bounds.top <= Math.max(...points.map(({ y }) => y)) + padY
            )
          })
        const ambiguous = endpointWitnesses.some(({ status }) => status === 'ambiguous')
        const missing = endpointWitnesses.some(({ status }) => status === 'unresolved')
        const detached = endpointWitnesses.some(({ status }) => status === 'detached')
        const status: Status = omitted
          ? 'unresolved'
          : ambiguous
            ? 'ambiguous'
            : missing
              ? 'unresolved'
              : detached
                ? 'detached'
                : 'continuous'
        let target = row.targets.find(({ kind, id }) => kind === face.kind && id === face.id)
        if (!target) {
          target = { kind: face.kind, id: face.id, faces: [] }
          row.targets.push(target)
        }
        target.faces.push({
          edgeIndex: face.edgeIndex,
          status,
          reason: omitted
            ? 'omitted-ink-near-source-target'
            : ambiguous
              ? 'competing-endpoint-witnesses'
              : missing
                ? 'missing-bounded-endpoint-witness'
                : detached
                  ? 'detached-source-extension'
                  : null,
          supportRefs: sourceRefs(face.supports),
          endpointWitnesses,
        })
      }
      row.targets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
      for (const target of row.targets) target.faces.sort((a, b) => a.edgeIndex - b.edgeIndex)
      if (row.targets.length > 1 || (row.targets[0]?.faces.length ?? 0) > 1) {
        row.status = 'ambiguous'
        row.reason =
          row.targets.length > 1 ? 'competing-source-targets' : 'source-target-face-alternatives'
      } else {
        const face = row.targets[0]?.faces[0]
        if (face) {
          row.status = face.status
          row.reason = face.reason
        }
      }
    }
    return finish(null)
  } catch (error) {
    return finish(
      error === exhausted ? 'dimension-target-work-limit' : 'source-target-association-unresolved',
    )
  }
}
