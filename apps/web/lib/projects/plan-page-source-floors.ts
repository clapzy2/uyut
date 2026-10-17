import type { PlanPageContours, PlanPageSegmentRef, PlanReading } from '@uyut/db'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativeFilledPanelJambContacts } from './plan-native-filled-panel-jambs'
import { type NativeFilledPanel, nativeFilledPanelCandidates } from './plan-native-filled-panels'
import type { SourcePaintBoundarySupport } from './plan-native-painted-floor-boundaries'
import type {
  nativePaintedFloorReview,
  ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import {
  nativeSourceOpeningContacts,
  type SourceOpeningInspection,
} from './plan-native-source-opening-contacts'
import {
  createNativeSourceSpanVisibility,
  NativeSourceVisibilityLimit,
} from './plan-native-source-span-visibility'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { findPlanPageWallBodySupports, type PdfWallBodySupport } from './plan-pdf-wall-body-support'

export type SourceMaterialClassification = {
  status: 'diagnostic'
  kind: 'framed-panel' | 'unclassified-body'
  reason:
    | 'exact-joined-filled-panel'
    | 'no-exact-joined-filled-panel'
    | 'filled-panel-search-unavailable'
  physicalBoundariesAccepted: false
  profileId: string | null
  sourceRefs: PlanPageSegmentRef[]
  endEvidence?: {
    status: 'matched' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
    coverage: 'complete' | 'partial' | 'unproved'
    sourceRefs: PlanPageSegmentRef[]
    sourceVisibility?: {
      status: 'unoccluded' | 'held'
      reason: string | null
      blockerOperations: number[]
    }[]
    physicalJambAccepted: false
  }[]
}

export type SourceFloorMaterialSpan = PdfWallBodySupport & {
  classification?: SourceMaterialClassification
}

export type SourceFloorMaterialSupports = {
  status: 'diagnostic' | 'held'
  semanticStatus: 'unclassified'
  physicalBoundariesAccepted: false
  source: PdfPlanSource
  sourceRevision: string
  reason: string | null
  /** The bounded legacy search does not certify a complete material inventory. */
  completeInventory: false
  spans: SourceFloorMaterialSpan[]
}

function materialClassification(
  span: PdfWallBodySupport,
  panels: NativeFilledPanel[],
  jambs: ReturnType<typeof nativeFilledPanelJambContacts>['panels'],
  unavailable: boolean,
  visibility?: ReturnType<typeof createNativeSourceSpanVisibility>,
): SourceMaterialClassification {
  const matches = panels.filter((panel) =>
    [panel.body, ...panel.caps].some(
      (part) =>
        part.operationIndex === span.source.operationIndex &&
        part.subpathIndex === span.source.subpathIndex,
    ),
  )
  const profile = matches.length === 1 ? matches[0] : undefined
  if (!profile || unavailable)
    return {
      status: 'diagnostic',
      kind: 'unclassified-body',
      reason: unavailable ? 'filled-panel-search-unavailable' : 'no-exact-joined-filled-panel',
      physicalBoundariesAccepted: false,
      profileId: null,
      sourceRefs: [],
    }
  const refs = [profile.body, ...profile.caps].flatMap((part) =>
    Array.from({ length: 4 }, (_, segmentIndex) => ({
      operationIndex: part.operationIndex,
      subpathIndex: part.subpathIndex,
      segmentIndex,
    })),
  )
  refs.push(span.strokeSegment)
  if (span.oppositeFace) refs.push(span.oppositeFace.strokeSegment)
  const unique = new Map(
    refs.map((ref) => [`${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`, ref]),
  )
  const jamb = jambs.find(
    (pair) =>
      pair.panelId === profile.id && pair.ends.every((end) => end.sourceEdges.length <= 100),
  )
  const exact = nativeFaceRationalPredicates()
  return {
    status: 'diagnostic',
    kind: 'framed-panel',
    reason: 'exact-joined-filled-panel',
    physicalBoundariesAccepted: false,
    profileId: profile.id,
    sourceRefs: [...unique.values()].sort(
      (a, b) =>
        a.operationIndex - b.operationIndex ||
        a.subpathIndex - b.subpathIndex ||
        a.segmentIndex - b.segmentIndex,
    ),
    ...(jamb
      ? {
          endEvidence: jamb.ends.map((end) => ({
            status: end.status,
            coverage: end.coverage,
            sourceRefs: end.sourceEdges.map(({ operationIndex, subpathIndex, segmentIndex }) => ({
              operationIndex,
              subpathIndex,
              segmentIndex,
            })),
            ...(visibility
              ? {
                  sourceVisibility: end.sourceEdges.map((edge) => {
                    const start = exactNativePointKey(end.profileEdge.start)
                    const finish = exactNativePointKey(end.profileEdge.end)
                    const sourceStart = exactNativePointKey(edge.start)
                    const sourceEnd = exactNativePointKey(edge.end)
                    const span =
                      start && finish && sourceStart && sourceEnd
                        ? exact.sharedSpan(start, finish, sourceStart, sourceEnd)
                        : null
                    if (!span) throw new Error('Missing literal panel-end contact')
                    const checked = visibility(edge, span.startKey, span.endKey)
                    return {
                      status: checked.status,
                      reason: checked.reason,
                      blockerOperations: checked.blockerOperations,
                    }
                  }),
                }
              : {}),
            physicalJambAccepted: false as const,
          })),
        }
      : {}),
  }
}

export type SourceFloorReference = {
  version: 1
  coordinateSystem: 'page-0-1000'
  source: PdfPlanSource
  sourceRevision: string
  pageWidth: number
  pageHeight: number
  status: 'not-saved' | 'held' | 'checked'
  reason: string | null
  readOnly: true
  physicalBoundariesAccepted: false
  boundaryInspection?: { status: 'checked' | 'held'; reason: string | null }
  openingInspection?: SourceOpeningInspection
  blockerPaint?: {
    status: 'checked' | 'held'
    reason: string | null
    /** Conservative paint envelopes, not the actual visible ink or a physical boundary. */
    events: {
      operationIndex: number
      kind: 'vector' | 'text' | 'image' | 'unknown'
      bounds: { left: number; top: number; right: number; bottom: number }
    }[]
  }
  floors: {
    id: string
    sourceRoomKey: string
    name: string
    polygon: { x: number; y: number }[]
    holes: { x: number; y: number }[][]
    exactPointKeys: string[]
    holeExactPointKeys: string[][]
    nonDecimalVertices: number
    omittedStrokeCount: number
    boundaryInkComplete: boolean
    boundarySupports?: SourcePaintBoundarySupport[]
    materialSupports?: SourceFloorMaterialSupports
  }[]
}

/** Fresh source-space reference, never a raster roundtrip or a physical contour. */
export function planPageSourceFloors(input: {
  source: PdfPlanSource
  sourceRevision: string
  pageWidth: number
  pageHeight: number
  reading: PlanReading
  includeSpanVisibility?: boolean
  includeBlockerPaint?: boolean
  evidence?: Omit<Parameters<typeof nativePaintedFloorReview>[0], 'reviewed'>
}): SourceFloorReference {
  const report: SourceFloorReference = {
    version: 1,
    coordinateSystem: 'page-0-1000',
    source: { ...input.source },
    sourceRevision: input.sourceRevision,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    status: 'not-saved',
    reason: null,
    readOnly: true,
    physicalBoundariesAccepted: false,
    floors: [],
  }
  const saved = input.reading.paintedFloorReview
  if (!saved) return report
  const hold = (reason: string) => ({ ...report, status: 'held' as const, reason, floors: [] })
  if (
    !/^[a-f0-9]{64}$/.test(input.sourceRevision) ||
    input.source.state !== 'existing' ||
    input.reading.sourcePage !== input.source.pdfPage ||
    input.reading.planState !== input.source.state ||
    !input.evidence ||
    input.evidence.native.originalPdfSha256 !== input.source.sha256 ||
    input.evidence.native.source.page !== input.source.pdfPage ||
    input.evidence.work.pageWidth !== input.pageWidth ||
    input.evidence.work.pageHeight !== input.pageHeight
  )
    return hold('source-floor-frame-mismatch')
  try {
    if (saved.version !== 1 || Buffer.byteLength(saved.draftJson, 'utf8') > 65536)
      return hold('invalid-saved-painted-floor-review')
    const reviewed = JSON.parse(saved.draftJson) as ReviewedNativePaintedFloors
    const fresh = nativeSourceOpeningContacts({
      ...input.evidence,
      reviewed,
      includeSpanVisibility: input.includeSpanVisibility || input.includeBlockerPaint,
    })
    if (fresh.refusalReason) return hold(fresh.refusalReason)
    report.status = 'checked'
    report.openingInspection = fresh.openingInspection
    report.boundaryInspection = {
      status: fresh.boundaryInspection.status,
      reason: fresh.boundaryInspection.reason,
    }
    report.floors = fresh.floors.map((floor) => ({
      id: floor.id,
      sourceRoomKey: floor.owner.sourceRoomKey,
      name: floor.owner.name,
      polygon: floor.polygon,
      holes: floor.holes,
      exactPointKeys: floor.exactPointKeys,
      holeExactPointKeys: floor.holeExactPointKeys,
      nonDecimalVertices: [floor.polygon, ...floor.holes].reduce((count, ring, ringIndex) => {
        const keys =
          ringIndex === 0 ? floor.exactPointKeys : floor.holeExactPointKeys[ringIndex - 1]
        return (
          count + ring.filter((point, index) => exactNativePointKey(point) !== keys?.[index]).length
        )
      }, 0),
      omittedStrokeCount: floor.omittedStrokeCount,
      boundaryInkComplete: floor.boundaryInkComplete,
      ...(fresh.boundaryInspection.status === 'checked'
        ? {
            boundarySupports: fresh.boundaryInspection.floors.find(
              (inspection) => inspection.floorId === floor.id,
            )?.edges,
          }
        : {}),
    }))
    // Run the existing one-sided material search separately from the original
    // paint-span visibility. A later independent stroke can be useful evidence
    // without reviving an obscured floor fill or declaring a physical wall.
    const eligible = report.floors.filter(
      (floor) => !floor.holes.length && floor.nonDecimalVertices === 0,
    )
    const tooManyPoints = eligible.reduce((count, floor) => count + floor.polygon.length, 0) > 2000
    // Local search adapter only: never persist this as a page review or transfer it to geometry.
    const contours: PlanPageContours = {
      source: { ...input.source },
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
      rooms: eligible.map((floor) => ({
        roomSourceNumber: Number(floor.sourceRoomKey),
        polygon: floor.polygon,
      })),
    }
    const supports = tooManyPoints
      ? []
      : findPlanPageWallBodySupports(input.evidence.work, contours)
    const outputLimit = supports.length > 1000
    const profiles =
      supports.length && !outputLimit
        ? nativeFilledPanelCandidates({ ...input.evidence, contactMode: 'exact-joined-endcaps' })
        : undefined
    const jambs =
      profiles && !profiles.refusalReason && profiles.panels.length
        ? nativeFilledPanelJambContacts({
            ...input.evidence,
            contactMode: 'exact-joined-endcaps',
          })
        : undefined
    const visibility =
      input.includeSpanVisibility || input.includeBlockerPaint
        ? createNativeSourceSpanVisibility(input.evidence.work)
        : undefined
    for (const floor of report.floors) {
      const reason = floor.holes.length
        ? 'material-support-holes-not-supported'
        : floor.nonDecimalVertices > 0
          ? 'material-support-rational-topology-not-supported'
          : tooManyPoints || outputLimit
            ? 'material-support-output-limit'
            : null
      floor.materialSupports = {
        status: reason ? 'held' : 'diagnostic',
        semanticStatus: 'unclassified',
        physicalBoundariesAccepted: false,
        source: { ...input.source },
        sourceRevision: input.sourceRevision,
        reason,
        completeInventory: false,
        spans: reason
          ? []
          : supports
              .filter((support) => support.contourKey === floor.sourceRoomKey)
              .map((support) => ({
                ...support,
                classification: materialClassification(
                  support,
                  profiles?.panels ?? [],
                  jambs?.panels ?? [],
                  !!profiles?.refusalReason,
                  visibility,
                ),
              })),
      }
    }
    if (input.includeBlockerPaint) {
      const blockerIds = new Set<number>()
      for (const floor of report.floors) {
        for (const edge of floor.boundarySupports ?? []) {
          for (const contact of edge.contacts) {
            for (const id of contact.visibility?.blockerOperations ?? []) blockerIds.add(id)
          }
        }
        for (const span of floor.materialSupports?.spans ?? []) {
          for (const end of span.classification?.endEvidence ?? []) {
            for (const visibility of end.sourceVisibility ?? []) {
              for (const id of visibility.blockerOperations) blockerIds.add(id)
            }
          }
        }
      }
      for (const target of report.openingInspection?.targets ?? []) {
        for (const id of target.visibility?.blockerOperations ?? []) blockerIds.add(id)
        for (const source of target.independentVisibility ?? []) {
          for (const id of source.visibility.blockerOperations) blockerIds.add(id)
        }
      }
      const paintEvents = new Map(
        input.evidence.work.paintBounds?.events.map((event) => [event.operationIndex, event]) ?? [],
      )
      const events = [...blockerIds].sort((a, b) => a - b).map((id) => paintEvents.get(id))
      const unavailable =
        blockerIds.size > 400 ||
        events.some(
          (event) =>
            !event?.bounds ||
            ![event.bounds.left, event.bounds.top, event.bounds.right, event.bounds.bottom].every(
              Number.isFinite,
            ) ||
            event.bounds.left > event.bounds.right ||
            event.bounds.top > event.bounds.bottom ||
            event.bounds.right < 0 ||
            event.bounds.bottom < 0 ||
            event.bounds.left > 1000 ||
            event.bounds.top > 1000,
        )
      report.blockerPaint = {
        status: unavailable ? 'held' : 'checked',
        reason: unavailable ? 'blocker-paint-display-unavailable' : null,
        events: unavailable
          ? []
          : events.flatMap((event) =>
              event?.bounds
                ? [{ operationIndex: event.operationIndex, kind: event.kind, bounds: event.bounds }]
                : [],
            ),
      }
    }
    return report
  } catch (error) {
    return hold(
      error instanceof NativeSourceVisibilityLimit
        ? error.message
        : 'invalid-saved-painted-floor-review',
    )
  }
}
