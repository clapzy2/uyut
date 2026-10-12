import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativeFilledPanelJambContacts } from './plan-native-filled-panel-jambs'
import { nativeOpeningFrameCandidates } from './plan-native-opening-frames'
import { nativePaintedFloorBoundarySupports } from './plan-native-painted-floor-boundaries'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

export type SourceOpeningTarget = {
  id: string
  objectId: string
  kind: 'frame-side' | 'frame-jamb' | 'panel-end'
  sourceRef: { operationIndex: number; subpathIndex: number; segmentIndex: number }
  startKey: string
  endKey: string
  frameInteriorSide: 'left' | 'right' | null
  independentSourceRefs: SourceOpeningTarget['sourceRef'][]
  sourceEndStatus: 'matched' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved' | null
  omittedInkCount: number
  laterPaintCount: number | null
  status: 'matched' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
  coverage: 'complete' | 'partial' | 'unproved'
  contacts: {
    floorId: string
    ringIndex: number
    edgeIndex: number
    startKey: string
    endKey: string
    regionSide: 'left' | 'right'
  }[]
}

export type SourceOpeningInspection = {
  status: 'checked' | 'held'
  reason: string | null
  completeOpeningInventory: false
  physicalJambAccepted: false
  physicalPassageAccepted: false
  finalPaintVisibilityProved: false
  targets: SourceOpeningTarget[]
}

type Input = Parameters<typeof nativePaintedFloorBoundarySupports>[0]
const sourceRef = ({ operationIndex, subpathIndex, segmentIndex }: NativePageSegment) => ({
  operationIndex,
  subpathIndex,
  segmentIndex,
})

/** Fresh selected paint rings to literal source frame/end spans, never a passage graph. */
export function nativeSourceOpeningContacts(input: Input) {
  const fresh = nativePaintedFloorBoundarySupports(input)
  const targets: SourceOpeningTarget[] = []
  const finish = (reason: string | null) => ({
    ...fresh,
    openingInspection: {
      status: reason ? 'held' : 'checked',
      reason,
      completeOpeningInventory: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      finalPaintVisibilityProved: false,
      targets: reason ? [] : targets,
    } satisfies SourceOpeningInspection,
  })
  if (fresh.refusalReason) return finish(fresh.refusalReason)
  if (fresh.boundaryInspection.status !== 'checked')
    return finish('source-boundary-inspection-unavailable')
  const frames = nativeOpeningFrameCandidates(input)
  const panels = nativeFilledPanelJambContacts(input)
  if (frames.refusalReason || panels.refusalReason)
    return finish(frames.refusalReason ?? panels.refusalReason)
  const exact = nativeFaceRationalPredicates()
  let workLeft = 300_000
  let contactCount = 0
  const exhausted = Symbol('source-opening-work-limit')
  const spend = () => {
    if (--workLeft < 0) throw exhausted
  }
  const append = (
    objectId: string,
    kind: SourceOpeningTarget['kind'],
    edge: NativePageSegment,
    frameInteriorSide: SourceOpeningTarget['frameInteriorSide'],
    independentEdges: NativePageSegment[],
    sourceEndStatus: SourceOpeningTarget['sourceEndStatus'],
    omittedInkCount: number,
    laterPaintCount: number | null,
  ) => {
    const startKey = exactNativePointKey(edge.start)
    const endKey = exactNativePointKey(edge.end)
    if (!startKey || !endKey || !exact.sharedSpan(startKey, endKey, startKey, endKey))
      throw new Error('Unsupported source target')
    const refs = [edge, ...independentEdges]
    if (
      refs.some(
        (ref) =>
          ref.operationIndex >= 100_000 || ref.subpathIndex > 3000 || ref.segmentIndex > 20_000,
      ) ||
      independentEdges.length > 100
    )
      throw new Error('Unsupported source target references')
    const target: SourceOpeningTarget = {
      id: `${objectId}:${kind}:${edge.segmentIndex}`,
      objectId,
      kind,
      sourceRef: sourceRef(edge),
      startKey,
      endKey,
      frameInteriorSide,
      independentSourceRefs: independentEdges.map(sourceRef),
      sourceEndStatus,
      omittedInkCount,
      laterPaintCount,
      status: 'unobserved',
      coverage: 'unproved',
      contacts: [],
    }
    const axis = exact.compareAxis(startKey, endKey, 'x') === 0 ? 'y' : 'x'
    for (const floor of fresh.floors) {
      for (const [ringIndex, ring] of [
        floor.exactPointKeys,
        ...floor.holeExactPointKeys,
      ].entries()) {
        const winding = exact.winding(ring) * (ringIndex === 0 ? 1 : -1)
        if (!winding) throw new Error('Unsupported selected ring')
        for (const [edgeIndex, a] of ring.entries()) {
          spend()
          const b = ring[(edgeIndex + 1) % ring.length] as string
          const span = exact.sharedSpan(startKey, endKey, a, b)
          if (!span) continue
          const direction =
            exact.compareAxis(a, b, axis) * exact.compareAxis(startKey, endKey, axis)
          target.contacts.push({
            floorId: floor.id,
            ringIndex,
            edgeIndex,
            ...span,
            regionSide: winding * direction > 0 ? 'left' : 'right',
          })
          if (++contactCount > 10_000 || target.contacts.length > 100) throw exhausted
        }
      }
    }
    const complete = exact.coversSpan(startKey, endKey, target.contacts)
    const competing =
      new Set(target.contacts.map((contact) => contact.floorId)).size > 1 ||
      new Set(target.contacts.map((contact) => contact.regionSide)).size > 1
    const sameInterior =
      kind === 'frame-side' &&
      target.contacts.some((contact) => contact.regionSide === frameInteriorSide)
    target.coverage = complete ? 'complete' : target.contacts.length ? 'partial' : 'unproved'
    const endHeld =
      kind === 'panel-end' && sourceEndStatus !== 'matched' && target.contacts.length > 0
    target.status =
      competing || (target.contacts.length > 0 && sourceEndStatus === 'ambiguous')
        ? 'ambiguous'
        : sameInterior || endHeld
          ? 'unresolved'
          : complete
            ? 'matched'
            : target.contacts.length
              ? 'partial'
              : 'unobserved'
    targets.push(target)
  }
  try {
    for (const frame of frames.candidates) {
      const ring = frame.frame.points.map(exactNativePointKey)
      if (ring.some((key) => key === null)) throw new Error('Unsupported source frame')
      const winding = exact.winding(ring as string[])
      if (!winding) throw new Error('Degenerate source frame')
      const side = winding > 0 ? 'left' : 'right'
      for (const edge of frame.longEdges)
        append(frame.id, 'frame-side', edge, side, [], null, frame.unresolvedInk.length, null)
      for (const jamb of frame.jambs)
        append(
          frame.id,
          'frame-jamb',
          jamb.frameEdge,
          side,
          jamb.sourceEdges,
          null,
          frame.unresolvedInk.length,
          null,
        )
    }
    for (const panel of panels.panels) {
      for (const end of panel.ends)
        append(
          panel.panelId,
          'panel-end',
          end.profileEdge,
          null,
          end.sourceEdges,
          end.status,
          panel.omittedInkCount,
          panel.laterPaintCount,
        )
    }
    return finish(null)
  } catch (error) {
    return finish(error === exhausted ? 'source-opening-work-limit' : 'source-opening-unavailable')
  }
}
