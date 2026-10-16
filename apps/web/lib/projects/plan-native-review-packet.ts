import type { PlanReading } from '@uyut/db'
import type { NativeTextAnchors } from './plan-document'
import {
  type NativeCaptionBindingReport,
  nativeCaptionBindings,
} from './plan-native-caption-bindings'
import { nativeCompositeFrameEvidence } from './plan-native-composite-frames'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import {
  type NativeDimensionTargetReport,
  nativeDimensionTargets,
} from './plan-native-dimension-targets'
import { nativeFaceAnnotationCandidates } from './plan-native-face-annotations'
import { nativeFilledPanelJambContacts } from './plan-native-filled-panel-jambs'
import { nativeFilledPanelCandidates } from './plan-native-filled-panels'
import { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import {
  type NativeFloorOpeningReport,
  nativeFloorOpeningSides,
} from './plan-native-floor-opening-sides'
import {
  type NativeHeightFloorReferences,
  nativeHeightFloorReferenceEvidence,
} from './plan-native-height-floor-reference'
import { nativeHeightSourceLocations } from './plan-native-height-locations'
import {
  type NativeHeightObjectReport,
  nativeHeightObjectEvidence,
} from './plan-native-height-objects'
import {
  type NativeHeightObservation,
  nativeHeightObservations,
} from './plan-native-height-observations'
import { nativeOpeningSourceLinks } from './plan-native-opening-links'
import {
  nativePaintedFloorReview,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import { nativePaintedRegionContext } from './plan-native-painted-region-context'
import { nativeReviewedFloorHeightBindings } from './plan-native-reviewed-floor-heights'
import { nativeReviewedFrameRooms } from './plan-native-reviewed-frame-rooms'
import { automaticNativeRoomCandidates, nativeRoomPolygonKey } from './plan-native-room-candidates'
import {
  type NativeRoomScheduleReport,
  nativeRoomNumberScheduleLinks,
} from './plan-native-room-number-links'
import { type NativeScaleEvidenceReport, nativeScaleEvidence } from './plan-native-scale-evidence'
import {
  type NativeSelectedDimensionBoundaryReport,
  nativeSelectedDimensionBoundaries,
} from './plan-native-selected-dimension-boundaries'
import {
  type NativeDimensionStrokeContactReport,
  nativeDimensionStrokeContacts,
} from './plan-native-stroke-contacts'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import {
  inspectReviewedPageCoverage,
  type ReviewedPageCoverage,
} from './plan-page-reviewed-coverage'
import type { PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { findPlanPageWallBodySupports } from './plan-pdf-wall-body-support'
import { validPlanPageWallSourceForLocalAudit } from './plan-pdf-wall-faces'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

export type NativeReviewPacket = {
  version: 1
  coordinateSystem: 'rendered-image-pixels'
  status: 'draft' | 'unresolved'
  source: PdfPlanSource
  image: RegionLabelFrame
  sourceRevision?: string
  sourcePageSize?: { width: number; height: number }
  extraction: {
    textComplete: boolean
    geometryComplete: boolean
    skippedCurves: number
    clippedPaths: number
  }
  counts: {
    fillCandidates: number
    strokeFaces: number
    annotationHints: number
    numberedAssociations: number
    printedDimensions: number
  }
  faces: {
    id: string
    layer: 'fill' | 'stroke'
    polygon: { x: number; y: number }[]
    annotationHint: boolean
    roomName?: string
  }[]
  paintedRegionContext?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    regions: {
      candidateId: string
      sourceRef: { operationIndex: number; subpathIndex: number }
      earlierPaintCount: number
      laterPaintCount: number
      unresolvedPaintCount: number
      possibleOmissionCount: number
    }[]
  }
  orderedPaint?: {
    status: 'diagnostic' | 'unresolved'
    refusalReason: string | null
    regions: {
      candidateId: string
      status: 'diagnostic' | 'held'
      refusalReason: string | null
      maskCount: number
      omittedStrokeCount: number
      boundaryInkComplete: boolean
      pieces: { polygon: { x: number; y: number }[]; holes: { x: number; y: number }[][] }[]
    }[]
  }
  doorSymbols?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: {
      id: string
      arc: {
        start: { x: number; y: number }
        segments: {
          control1: { x: number; y: number }
          control2: { x: number; y: number }
          end: { x: number; y: number }
        }[]
      }
      leaf: { start: { x: number; y: number }; end: { x: number; y: number } }
      leafParts?: { start: { x: number; y: number }; end: { x: number; y: number } }[]
      leafProfile?: 'single-stroke' | 'capped-panel'
      swingAngleDegrees?: number
      endpointResidualPixels: number
    }[]
  }
  openingFrames?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: { id: string; polygon: { x: number; y: number }[] }[]
  }
  compositeSourceRectangles?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    semanticStatus: 'unclassified'
    physicalPassageAccepted: false
    closesFloorBoundary: false
    candidates: {
      id: string
      polygon: { x: number; y: number }[]
      sourceRefs: { operationIndex: number; subpathIndex: number; segmentIndex: number }[]
      repaintAliases: { operationIndex: number; subpathIndex: number; segmentIndex: number }[][]
      completeContactCount: number
      filledBoundaryContactCount?: number
      jambContacts?: {
        edge: { operationIndex: number; subpathIndex: number; segmentIndex: number }
        sources: { operationIndex: number; subpathIndex: number; segmentIndex: number }[]
        filledBoundarySources: {
          operationIndex: number
          subpathIndex: number
          segmentIndex: number
        }[]
      }[]
    }[]
  }
  oneSidedWallSupports?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    physicalWallAccepted: false
    candidates: {
      id: string
      start: { x: number; y: number }
      end: { x: number; y: number }
      fillEdge: { operationIndex: number; subpathIndex: number; segmentIndex: number }
      strokeEdge: { operationIndex: number; subpathIndex: number; segmentIndex: number }
      oppositeFace?: {
        start: { x: number; y: number }
        end: { x: number; y: number }
        fillEdge: { operationIndex: number; subpathIndex: number; segmentIndex: number }
        strokeEdge: { operationIndex: number; subpathIndex: number; segmentIndex: number }
      }
      contourKey: string
      wallEdgeIndex: number
    }[]
  }
  glazingSymbols?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: {
      id: string
      polygons: { x: number; y: number }[][]
      centerline: { start: { x: number; y: number }; end: { x: number; y: number } }
    }[]
  }
  sourceLinks?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    doors: {
      symbolId: string
      status: 'linked' | 'ambiguous' | 'unresolved'
      targetKind: 'opening-frame' | 'glazing-panel' | null
      targetId: string | null
      relation: 'jamb-to-frame' | 'shared-cap-edge' | null
    }[]
    glazing: { symbolId: string; status: 'two-sided' | 'ambiguous' | 'unresolved' }[]
    groups: { id: string; glazingIds: string[]; doorIds: string[] }[]
  }
  filledPanelSymbols?: {
    status: 'draft' | 'unresolved'
    basis: 'native-filled-quad-and-opposed-cap-overlap'
    refusalReason: string | null
    completeOpeningInventory: false
    physicalJambAccepted: false
    physicalPassageAccepted: false
    closesFloorBoundary: false
    finalPaintVisibilityProved: false
    candidates: {
      id: string
      sourceRefs: { operationIndex: number; subpathIndex: number }[]
      polygons: { x: number; y: number }[][]
      laterPaintCount: number
      omittedInkCount: number
    }[]
  }
  numberCircles?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    cues: { labelId: string; sourceNumber: number }[]
  }
  roomSchedule?: NativeRoomScheduleReport
  dimensionDiscovery?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: { labelId: string; valueMm: number; axis: 'width' | 'depth' }[]
    unresolved: { labelId: string; reason: string }[]
  }
  sourceCaptionBindings?: NativeCaptionBindingReport
  dimensionTargets?: NativeDimensionTargetReport
  dimensionStrokeContacts?: NativeDimensionStrokeContactReport
  selectedDimensionBoundaries?: NativeSelectedDimensionBoundaryReport
  scaleEvidence?: NativeScaleEvidenceReport
  heightObservations?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    observations: Omit<NativeHeightObservation, 'pagePoint'>[]
    issues: { labelId: string; originalText: string; code: string }[]
    omissionCounts: { skippedCurves: number; clippedPaths: number }
    locations?: Pick<
      ReturnType<typeof nativeHeightSourceLocations>,
      'status' | 'refusalReason' | 'observations'
    >
  }
  heightObjects?: NativeHeightObjectReport
  heightFloorReferences?: NativeHeightFloorReferences
  savedFloorHeights?: {
    status: 'not-saved' | 'refused' | 'checked'
    reason: string | null
    associationBasis: 'manual-whole-source-caption-in-selected-floor'
    physicalBoundariesAccepted: false
    ceilingHeightsConfirmed: false
    commonZeroConfirmed: false
    readyFor2D: false
    readyFor3D: false
    bindings: ReturnType<typeof nativeReviewedFloorHeightBindings>['bindings']
  }
  filledPanelEnds?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    physicalJambAccepted: false
    wallOwnershipConfirmed: false
    panels: {
      panelId: string
      status: 'paired' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
      ends: {
        edgeIndex: number
        status: 'matched' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
        coverage: 'complete' | 'partial' | 'unproved'
        reason: string | null
        sourceEdges: { operationIndex: number; subpathIndex: number; segmentIndex: number }[]
      }[]
    }[]
  }
  savedPaintedFloors?: {
    status: 'not-saved' | 'refused' | 'checked'
    reason: string | null
    physicalBoundariesAccepted: false
    measurementsConfirmed: false
    commonZeroConfirmed: false
    floors: {
      id: string
      candidateId: string
      sourceRoomKey: string
      name: string
      nameLabelId: string
      numberLabelId: string
      polygon: { x: number; y: number }[]
      holes: { x: number; y: number }[][]
      exactPointKeys?: string[]
      holeExactPointKeys?: string[][]
      unresolvedEdges: number
      omittedStrokeCount: number
      boundaryInkComplete: boolean
    }[]
  }
  floorOpeningSides?: NativeFloorOpeningReport
  floorCavities?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: {
      id: string
      polygon: { x: number; y: number }[]
      markerLabelIds: string[]
      markerStatus: 'unambiguous' | 'ambiguous' | 'unmarked' | 'unavailable'
      closureIds: string[]
      unknownInteriorStrokeCount: number
      omittedBoundaryInkCount: number
    }[]
    thresholds: { frameId: string; paintAmbiguous: boolean }[]
    closures: {
      id: string
      sourceKind: 'closed-path' | 'literal-closed-run'
      remainingSegmentCount: number
      paintAmbiguous: boolean
    }[]
    unprovedCavities: { reason: string; vertexCount: number }[]
    unresolvedMarkerLabelIds: string[]
    markersAvailable: boolean
    markerLeaders?: {
      labelId: string
      cavityId: string
      circleEndpoint: 'start' | 'end'
      segment: {
        operationIndex: number
        subpathIndex: number
        segmentIndex: number
        start: { x: number; y: number }
        end: { x: number; y: number }
      }
    }[]
  }
  savedFrameRooms?:
    | { status: 'not-saved' }
    | { status: 'unavailable' | 'refused'; reason: string }
    | {
        status: 'checked'
        frames: {
          frameId: string
          status:
            | 'two-reviewed-sides'
            | 'one-reviewed-side'
            | 'coincident-sides'
            | 'ambiguous'
            | 'unresolved'
          sides: {
            roomSourceNumbers: number[]
            openingId: string
            kind: 'door' | 'window' | 'balcony'
            frameEdgeIndex: number
            numberCue: 'inside' | 'not-inside' | 'ambiguous' | 'unavailable'
          }[]
        }[]
      }
  issues: { code: string; message: string }[]
  readiness: { readyFor2D: false; readyFor3D: false; readOnly: true }
  savedReview:
    | { status: 'not-saved' }
    | { status: 'unavailable'; reason: 'native-layer-unavailable' | 'unsupported-review-version' }
    | { status: 'checked'; coverage: Omit<ReviewedPageCoverage, 'reviewSpans'> }
}

/** Whole-page inspection only. No reviews are invented; this packet is never PlanGeometry. */
export function nativeReviewPacket(input: {
  source: PdfPlanSource
  image: RegionLabelFrame
  native?: NativeTextAnchors
  work?: PdfLinework
  lineworkSource?: RegionLabelFrame
  savedReading?: PlanReading
  includeEndpointWitnesses?: boolean
}): NativeReviewPacket {
  const { source, image, native, work, lineworkSource } = input
  const packet: NativeReviewPacket = {
    version: 1,
    coordinateSystem: 'rendered-image-pixels',
    status: 'unresolved',
    source: { ...source },
    image: { ...image },
    extraction: {
      textComplete: native?.complete ?? false,
      geometryComplete: false,
      skippedCurves: work?.skippedCurves ?? 0,
      clippedPaths: work?.clippedPaths ?? 0,
    },
    counts: {
      fillCandidates: 0,
      strokeFaces: 0,
      annotationHints: 0,
      numberedAssociations: 0,
      printedDimensions: 0,
    },
    faces: [],
    issues: [],
    readiness: { readyFor2D: false, readyFor3D: false, readOnly: true },
    savedReview: { status: 'not-saved' },
    savedFrameRooms: { status: 'not-saved' },
  }
  if (input.includeEndpointWitnesses && work)
    packet.sourcePageSize = { width: work.pageWidth, height: work.pageHeight }
  const issue = (code: string, message: string) => packet.issues.push({ code, message })
  if (source.state !== 'existing' || source.pdfPage !== image.page)
    throw new Error('Native inspection requires the selected existing-state page')
  const savedReading = input.savedReading
  const review = savedReading?.pageReview
  if (review && savedReading) {
    packet.savedFrameRooms = {
      status: 'unavailable',
      reason: review.version !== 1 ? 'unsupported-review-version' : 'native-layer-unavailable',
    }
    if (review.version !== 1)
      packet.savedReview = { status: 'unavailable', reason: 'unsupported-review-version' }
    else if (!work)
      packet.savedReview = { status: 'unavailable', reason: 'native-layer-unavailable' }
    else {
      const { reviewSpans: _reviewSpans, ...coverage } = inspectReviewedPageCoverage({
        source,
        reading: savedReading,
        contours: review.contours,
        linework: work,
      })
      packet.savedReview = { status: 'checked', coverage }
    }
  }
  if (!native || !work || !lineworkSource) {
    issue(
      'native-layers-unavailable',
      'Нативные линии или подписи недоступны. Нужна отдельная сверка исходника.',
    )
    return packet
  }
  bindObservedRegionLabels({
    regionSource: image,
    labelSource: native.source,
    regions: [],
    labels: [],
  })
  bindObservedRegionLabels({
    regionSource: image,
    labelSource: lineworkSource,
    regions: [],
    labels: [],
  })
  if (native.originalPdfSha256 !== source.sha256)
    throw new Error('Native inspection source hash changed')
  const common = { native, work, lineworkSource }
  const filledPanels = nativeFilledPanelCandidates(common)
  packet.heightFloorReferences = nativeHeightFloorReferenceEvidence({ ...common, source })
  const panelEnds = nativeFilledPanelJambContacts(common)
  packet.filledPanelEnds = {
    status: panelEnds.status,
    refusalReason: panelEnds.refusalReason,
    physicalJambAccepted: false,
    wallOwnershipConfirmed: false,
    panels: panelEnds.panels.map((panel) => ({
      panelId: panel.panelId,
      status: panel.status,
      ends: panel.ends.map((end) => ({
        edgeIndex: end.profileEdge.segmentIndex,
        status: end.status,
        coverage: end.coverage,
        reason: end.reason,
        sourceEdges: end.sourceEdges.map(({ operationIndex, subpathIndex, segmentIndex }) => ({
          operationIndex,
          subpathIndex,
          segmentIndex,
        })),
      })),
    })),
  }
  const scheduleNumbers = nativeRoomNumberScheduleLinks(common)
  const circles = scheduleNumbers.circles
  packet.numberCircles = {
    status: circles.status,
    refusalReason: circles.refusalReason,
    cues: circles.cues.map(({ labelId, sourceNumber }) => ({ labelId, sourceNumber })),
  }
  packet.roomSchedule = scheduleNumbers.report
  const correspondences = nativeReviewedFrameRooms({ ...common, source, reading: savedReading })
  if (correspondences.status === 'checked')
    packet.savedFrameRooms = { status: 'checked', frames: correspondences.frames }
  else if (correspondences.status === 'not-saved') packet.savedFrameRooms = { status: 'not-saved' }
  else
    packet.savedFrameRooms = {
      status: correspondences.status,
      reason: correspondences.reason ?? 'source-correspondence-unavailable',
    }
  const rooms = automaticNativeRoomCandidates(common)
  const annotations = nativeFaceAnnotationCandidates(common)
  const dimensions = automaticNativeDimensionRoles({ ...common, source })
  const heights = nativeHeightObservations({ ...common, source })
  packet.dimensionDiscovery = {
    status: dimensions.refusalReason ? 'unresolved' : 'draft',
    refusalReason: dimensions.refusalReason,
    candidates: dimensions.candidates.map(({ labelId, valueMm, axis }) => ({
      labelId,
      valueMm,
      axis,
    })),
    unresolved: dimensions.unresolved,
  }
  const captionBindings = nativeCaptionBindings({ ...common, source })
  packet.sourceCaptionBindings = {
    status: captionBindings.status,
    refusalReason: captionBindings.refusalReason,
    candidates: captionBindings.candidates.map(({ spanEnds: _ends, ...candidate }) => candidate),
    unresolved: captionBindings.unresolved,
  }
  const dimensionTargets = nativeDimensionTargets({ ...common, source }, captionBindings)
  packet.dimensionStrokeContacts = nativeDimensionStrokeContacts(
    { ...common, source },
    captionBindings,
  )
  packet.dimensionTargets = {
    status: dimensionTargets.status,
    refusalReason: dimensionTargets.refusalReason,
    observations: dimensionTargets.observations,
    unresolved: dimensionTargets.unresolved,
    ...(dimensionTargets.jambSpans ? { jambSpans: dimensionTargets.jambSpans } : {}),
  }
  const scaleEvidence = nativeScaleEvidence({ ...common, source }, captionBindings)
  packet.scaleEvidence = {
    status: scaleEvidence.status,
    refusalReason: scaleEvidence.refusalReason,
    dimensionToleranceMm: scaleEvidence.dimensionToleranceMm,
    axes: scaleEvidence.axes,
    commonScale: scaleEvidence.commonScale,
    unresolved: scaleEvidence.unresolved,
  }
  packet.heightObservations = {
    status: heights.status,
    refusalReason: heights.refusalReason,
    observations: heights.observations.map(({ pagePoint: _point, ...observation }) => observation),
    issues: heights.issues,
    omissionCounts: heights.omissionCounts,
  }
  const heightLocations = nativeHeightSourceLocations({ ...common, source })
  packet.heightObservations.locations = {
    status: heightLocations.status,
    refusalReason: heightLocations.refusalReason,
    observations: heightLocations.observations,
  }
  const heightObjects = nativeHeightObjectEvidence({ ...common, source })
  packet.heightObjects = {
    status: heightObjects.status,
    refusalReason: heightObjects.refusalReason,
    declarations: heightObjects.declarations,
    unsupportedDeclarations: heightObjects.unsupportedDeclarations,
    bindings: heightObjects.bindings,
  }
  const connections = nativeOpeningSourceLinks(common)
  const floor = nativeFloorCavityCandidates(common)
  const floorSides = nativeFloorOpeningSides(floor, connections)
  packet.floorOpeningSides = {
    status: floorSides.status,
    refusalReason: floorSides.refusalReason,
    frames: floorSides.frames,
  }
  const doors = connections.doorSymbols
  const frames = connections.openingFrames
  packet.sourceLinks = {
    status: connections.status,
    refusalReason: connections.refusalReason,
    doors: connections.doorLinks.map(({ evidence: _evidence, ...link }) => link),
    glazing: connections.glazingLinks.map(({ symbolId, status }) => ({ symbolId, status })),
    groups: connections.groups.map(({ bridges: _bridges, ...group }) => group),
  }
  const scale = native.pageNormalizedScale
  if (scale) {
    const raster = (point: { x: number; y: number }) => ({
      x: point.x * scale.x,
      y: point.y * scale.y,
    })
    if (
      review?.contours &&
      review.contours.source.sha256 === source.sha256 &&
      review.contours.source.pdfPage === source.pdfPage &&
      validPlanPageWallSourceForLocalAudit(work, source, review.contours)
    ) {
      const supports = findPlanPageWallBodySupports(work, review.contours)
      const limitReached = supports.length > 100
      const incompleteSource =
        supports.length === 0 &&
        (work.truncated ||
          work.skippedCurves > 0 ||
          work.clippedPaths > 0 ||
          work.unsupportedPaths > 0 ||
          work.unsupportedContexts > 0 ||
          review.contours.rooms.some((room) => room.sourceTopology !== undefined))
      packet.oneSidedWallSupports = {
        status: limitReached || incompleteSource ? 'unresolved' : 'draft',
        refusalReason: limitReached
          ? 'source-wall-support-limit'
          : incompleteSource
            ? 'source-wall-evidence-incomplete'
            : null,
        physicalWallAccepted: false,
        candidates:
          !limitReached && !incompleteSource
            ? supports.map((support, index) => ({
                id: `one-sided-wall-support-${index}`,
                start: raster(support.start),
                end: raster(support.end),
                fillEdge: support.nativeSegment,
                strokeEdge: support.strokeSegment,
                ...(support.oppositeFace
                  ? {
                      oppositeFace: {
                        start: raster(support.oppositeFace.start),
                        end: raster(support.oppositeFace.end),
                        fillEdge: support.oppositeFace.nativeSegment,
                        strokeEdge: support.oppositeFace.strokeSegment,
                      },
                    }
                  : {}),
                contourKey: support.contourKey,
                wallEdgeIndex: support.wallEdgeIndex,
              }))
            : [],
      }
    }
    const rectangles = nativeCompositeFrameEvidence(work, scale)
    const sourceRef = ({
      operationIndex,
      subpathIndex,
      segmentIndex,
    }: {
      operationIndex: number
      subpathIndex: number
      segmentIndex: number
    }) => ({ operationIndex, subpathIndex, segmentIndex })
    packet.compositeSourceRectangles = {
      status: rectangles.refusalReason ? 'unresolved' : 'draft',
      refusalReason: rectangles.refusalReason,
      semanticStatus: 'unclassified',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      candidates: rectangles.candidates.map((candidate, index) => ({
        id: `composite-source-rectangle-${index}`,
        polygon: candidate.polygon.map(raster),
        sourceRefs: candidate.edges.map(sourceRef),
        repaintAliases: candidate.repaintAliases.map((edges) => edges.map(sourceRef)),
        completeContactCount: candidate.jambContacts.filter(
          (contact) => contact.coverage === 'complete',
        ).length,
        filledBoundaryContactCount: candidate.jambContacts.filter(
          (contact) => contact.filledBoundaryCoverage === 'complete',
        ).length,
        jambContacts: candidate.jambContacts.map((contact) => ({
          edge: sourceRef(contact.edge),
          sources: contact.sources.map(sourceRef),
          filledBoundarySources: contact.filledBoundarySources.map(sourceRef),
        })),
      })),
    }
    packet.savedPaintedFloors = {
      status: 'not-saved',
      reason: null,
      floors: [],
      physicalBoundariesAccepted: false,
      measurementsConfirmed: false,
      commonZeroConfirmed: false,
    }
    const savedFloors = savedReading?.paintedFloorReview
    if (savedFloors) {
      try {
        if (
          savedFloors.version !== 1 ||
          typeof savedFloors.draftJson !== 'string' ||
          new TextEncoder().encode(savedFloors.draftJson).byteLength > 65_536
        )
          throw new Error('invalid-saved-painted-floor-review')
        const reviewed = JSON.parse(savedFloors.draftJson) as ReviewedNativePaintedFloors
        const report = nativePaintedFloorReview({ ...common, reviewed })
        packet.savedPaintedFloors.status = report.refusalReason ? 'refused' : 'checked'
        packet.savedPaintedFloors.reason = report.refusalReason
        packet.savedPaintedFloors.floors = report.floors.map((floor) => ({
          id: floor.id,
          candidateId: floor.candidateId,
          sourceRoomKey: floor.owner.sourceRoomKey,
          name: floor.owner.name,
          nameLabelId: floor.owner.nameLabelId,
          numberLabelId: floor.owner.numberLabelId,
          polygon: floor.polygon.map(raster),
          holes: floor.holes.map((hole) => hole.map(raster)),
          ...(input.includeEndpointWitnesses
            ? { exactPointKeys: floor.exactPointKeys, holeExactPointKeys: floor.holeExactPointKeys }
            : {}),
          unresolvedEdges: floor.edges.filter((edge) => edge.declaredRole === 'unresolved').length,
          omittedStrokeCount: floor.omittedStrokeCount,
          boundaryInkComplete: floor.boundaryInkComplete,
        }))
        packet.selectedDimensionBoundaries = nativeSelectedDimensionBoundaries(
          { ...common, source, reviewed, includeEndpointWitnesses: input.includeEndpointWitnesses },
          captionBindings,
        )
      } catch {
        packet.savedPaintedFloors.status = 'refused'
        packet.savedPaintedFloors.reason = 'invalid-saved-painted-floor-review'
      }
    }
    packet.savedFloorHeights = {
      status: 'not-saved',
      reason: null,
      associationBasis: 'manual-whole-source-caption-in-selected-floor',
      physicalBoundariesAccepted: false,
      ceilingHeightsConfirmed: false,
      commonZeroConfirmed: false,
      readyFor2D: false,
      readyFor3D: false,
      bindings: [],
    }
    const savedHeights = savedReading?.heightBindingReview
    if (savedHeights) {
      try {
        if (
          !savedFloors ||
          packet.savedPaintedFloors.status !== 'checked' ||
          savedHeights.version !== 1 ||
          typeof savedHeights.draftJson !== 'string' ||
          new TextEncoder().encode(savedHeights.draftJson).byteLength > 16_384
        )
          throw new Error('invalid-saved-room-height-review')
        const report = nativeReviewedFloorHeightBindings({
          ...common,
          reviewedFloors: JSON.parse(savedFloors.draftJson),
          floorReviewSavedAt: savedFloors.savedAt,
          reviewed: JSON.parse(savedHeights.draftJson),
        })
        packet.savedFloorHeights.status = report.refusalReason ? 'refused' : 'checked'
        packet.savedFloorHeights.reason = report.refusalReason
        packet.savedFloorHeights.bindings = report.bindings
      } catch {
        packet.savedFloorHeights.status = 'refused'
        packet.savedFloorHeights.reason = 'invalid-saved-room-height-review'
      }
    }
    packet.filledPanelSymbols = {
      status: filledPanels.status,
      basis: filledPanels.basis,
      refusalReason: filledPanels.refusalReason,
      completeOpeningInventory: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      finalPaintVisibilityProved: false,
      candidates: filledPanels.panels.map((panel) => ({
        id: panel.id,
        sourceRefs: [panel.body, ...panel.caps].map(({ operationIndex, subpathIndex }) => ({
          operationIndex,
          subpathIndex,
        })),
        polygons: [panel.body, ...panel.caps].map((path) => path.points.map(raster)),
        laterPaintCount: panel.laterPaintCount,
        omittedInkCount: panel.unresolvedInk.length,
      })),
    }
    packet.floorCavities = {
      status: floor.status,
      refusalReason: floor.refusalReason,
      candidates: floor.cavities.map((cell) => ({
        id: cell.id,
        polygon: cell.polygon.map(raster),
        markerLabelIds: cell.markerLabelIds,
        markerStatus: cell.markerStatus,
        closureIds: cell.closureIds,
        unknownInteriorStrokeCount: cell.unknownInteriorStrokeCount,
        omittedBoundaryInkCount: cell.omittedBoundaryInkCount,
      })),
      thresholds: floor.thresholds.map(({ frameId, paintColors }) => ({
        frameId,
        paintAmbiguous: paintColors.length !== 1,
      })),
      closures: floor.closures.map((closure) => ({
        id: closure.id,
        sourceKind: closure.sourceKind,
        remainingSegmentCount: closure.remainingSegments.length,
        paintAmbiguous: closure.paintColors.length !== 1,
      })),
      unprovedCavities: floor.unprovedCavities.map(({ reason, vertexCount }) => ({
        reason,
        vertexCount,
      })),
      unresolvedMarkerLabelIds: floor.unresolvedMarkerLabelIds,
      markersAvailable: floor.markersAvailable,
      markerLeaders: floor.markerLeaders.map(({ labelId, cavityId, circleEndpoint, segment }) => ({
        labelId,
        cavityId,
        circleEndpoint,
        segment: { ...segment, start: raster(segment.start), end: raster(segment.end) },
      })),
    }
    packet.doorSymbols = {
      status: doors.status,
      refusalReason: doors.refusalReason,
      candidates: doors.candidates.map((door) => ({
        id: door.id,
        arc: {
          start: raster(door.arc.start),
          segments: door.arc.segments.map((segment) => ({
            control1: raster(segment.control1),
            control2: raster(segment.control2),
            end: raster(segment.end),
          })),
        },
        leaf: { start: raster(door.leaf.start), end: raster(door.leaf.end) },
        ...(door.leafParts
          ? {
              leafParts: door.leafParts.map((part) => ({
                start: raster(part.start),
                end: raster(part.end),
              })),
            }
          : {}),
        leafProfile: door.leafProfile,
        swingAngleDegrees: door.swingAngleDegrees,
        endpointResidualPixels: door.endpointResidualPixels,
      })),
    }
    packet.openingFrames = {
      status: frames.status,
      refusalReason: frames.refusalReason,
      candidates: frames.candidates.map((candidate) => ({
        id: candidate.id,
        polygon: candidate.frame.points.map(raster),
      })),
    }
    packet.glazingSymbols = {
      status: doors.compoundPanels.status,
      refusalReason: doors.compoundPanels.refusalReason,
      candidates: doors.compoundPanels.panels.flatMap((panel) =>
        panel.centerline
          ? [
              {
                id: `native-glazing-symbol-${panel.body.operationIndex}:${panel.body.subpathIndex}`,
                polygons: [panel.body, ...panel.caps].map((path) => path.points.map(raster)),
                centerline: {
                  start: raster(panel.centerline.start),
                  end: raster(panel.centerline.end),
                },
              },
            ]
          : [],
      ),
    }
  }
  const fills = rooms.geometry
  const strokes = annotations.geometry
  packet.extraction.geometryComplete =
    !fills.truncated &&
    !strokes.truncated &&
    !rooms.strokeGeometry.truncated &&
    rooms.frameFaces?.status !== 'unresolved' &&
    work.skippedCurves === 0 &&
    work.clippedPaths === 0
  packet.status = packet.extraction.geometryComplete && native.complete ? 'draft' : 'unresolved'
  const named = new Map(
    rooms.associations.flatMap((entry) => entry.regionIds.map((id) => [id, entry.name] as const)),
  )
  const tagged = new Set(annotations.annotations.map((entry) => entry.faceId))
  const strokeOverlays = new Map<string, NativeReviewPacket['faces'][number]>()
  for (const face of strokes.candidates)
    strokeOverlays.set(nativeRoomPolygonKey(face.polygon), {
      id: face.id,
      layer: 'stroke',
      polygon: face.rasterPolygon.map((point) => ({ ...point })),
      annotationHint: tagged.has(face.id),
    })
  // A numbered endpoint ring can survive where bounded faces refuse an interior
  // caption box. Preserve the source shape, never erase that box or invent a floor.
  for (const cycle of [
    ...rooms.strokeGeometry.candidates,
    ...(rooms.frameFaces?.geometry?.candidates ?? []),
  ]) {
    if (!named.has(cycle.id)) continue
    const key = nativeRoomPolygonKey(cycle.polygon)
    const existing = strokeOverlays.get(key)
    if (existing) existing.roomName = named.get(cycle.id)
    else
      strokeOverlays.set(key, {
        id: cycle.id,
        layer: 'stroke',
        polygon: cycle.rasterPolygon.map((point) => ({ ...point })),
        annotationHint: false,
        roomName: named.get(cycle.id),
      })
  }
  const faces = [
    ...fills.candidates.map((face) => ({
      id: face.id,
      layer: 'fill' as const,
      polygon: face.rasterPolygon.map((point) => ({ ...point })),
      annotationHint: false,
      ...(named.has(face.id) ? { roomName: named.get(face.id) } : {}),
    })),
    ...strokeOverlays.values(),
  ]
  if (faces.length > 100) {
    packet.status = 'unresolved'
    issue(
      'native-overlay-limit',
      'Достигнут лимит областей для наложения. Неполный набор контуров не показан; нужна отдельная сверка исходника.',
    )
  } else packet.faces = faces
  const paintContext = nativePaintedRegionContext(common)
  packet.paintedRegionContext =
    faces.length > 100
      ? {
          status: 'unresolved',
          refusalReason: 'native-overlay-limit',
          regions: [],
        }
      : {
          status: paintContext.status,
          refusalReason: paintContext.refusalReason,
          regions: paintContext.contexts.map((context) => ({
            candidateId: context.candidateId,
            sourceRef: context.sourceRef,
            earlierPaintCount: context.paintContacts.filter(
              (contact) => contact.order === 'earlier',
            ).length,
            laterPaintCount: context.paintContacts.filter((contact) => contact.order === 'later')
              .length,
            unresolvedPaintCount: context.paintContacts.filter(
              (contact) => contact.relation === 'unresolved-paint',
            ).length,
            possibleOmissionCount: context.possibleOmissions.length,
          })),
        }
  const orderedPaint = nativeVisiblePaintRegions(common)
  if (scale && faces.length <= 100) {
    const rasterPoint = (point: { x: number; y: number }) => ({
      x: point.x * scale.x,
      y: point.y * scale.y,
    })
    packet.orderedPaint = {
      status: orderedPaint.status,
      refusalReason: orderedPaint.refusalReason,
      regions: orderedPaint.regions.map((region) => ({
        candidateId: region.candidateId,
        status: region.status,
        refusalReason: region.refusalReason,
        maskCount: region.masks.length,
        omittedStrokeCount: region.omittedStrokeCount,
        boundaryInkComplete: region.boundaryInkComplete,
        pieces: region.pieces.map((piece) => ({
          polygon: piece.polygon.map(rasterPoint),
          holes: piece.holes.map((hole) => hole.map(rasterPoint)),
        })),
      })),
    }
  } else {
    packet.orderedPaint = {
      status: 'unresolved',
      refusalReason: 'source-overlay-unavailable',
      regions: [],
    }
  }
  packet.counts = {
    fillCandidates: fills.candidates.length,
    strokeFaces: strokeOverlays.size,
    annotationHints: annotations.annotations.length,
    numberedAssociations: rooms.associations.length,
    printedDimensions: dimensions.candidates.length,
  }
  if (!packet.extraction.geometryComplete)
    issue(
      'native-geometry-incomplete',
      'Извлечение линий неполное или достигнут лимит проверки. Полнота схемы не доказана.',
    )
  if (!native.complete || native.labels.length === 0)
    issue(
      'native-text-unavailable',
      'Нет полного нативного текста. Эта проверка не выполняет OCR скана.',
    )
  if (rooms.status === 'unresolved')
    issue(
      'room-associations-unresolved',
      'Связь названий с контурами не установлена для этого формата плана.',
    )
  else if (rooms.unresolvedSourceNumbers.length)
    issue('room-associations-partial', 'Часть номеров помещений не связана с найденными областями.')
  if (rooms.frameFaces?.status === 'not-applicable')
    issue(
      'number-frame-faces-unavailable',
      'Связанные контуры по рамкам номеров здесь не проверены: нужны изолированные рамки и полный слой прямых линий без пропусков.',
    )
  if (annotations.unknownFaceIds.length || fills.candidates.length)
    issue(
      'face-roles-unconfirmed',
      'Назначение областей не подтверждено: среди них могут быть стены, таблицы и элементы чертежа.',
    )
  if (dimensions.refusalReason)
    issue('dimension-evidence-unresolved', 'Подписанные размеры не удалось проверить полностью.')
  else if (dimensions.unresolved.length)
    issue(
      'dimension-evidence-partial',
      'Часть числовых подписей не связана с единственной размерной линией. Они не используются как проверенные мерки.',
    )
  for (const [stage, reason] of [
    ['room-format', rooms.status === 'unresolved' ? rooms.reason : null],
    ['stroke-search', strokes.refusalReason],
    ['annotation-hints', annotations.refusalReason],
    ['dimension-search', dimensions.refusalReason],
    ['door-symbol-search', doors.refusalReason],
    ['opening-frame-search', frames.refusalReason],
    ['panel-profile-search', doors.compoundPanels.refusalReason],
    ['source-link-search', connections.refusalReason],
    ['number-circle-search', circles.refusalReason],
    ['room-schedule-search', scheduleNumbers.report.refusalReason],
    ['floor-cavity-search', floor.refusalReason],
  ] as const) {
    if (reason)
      issue(
        `${stage}:${reason}`,
        `Ограничение ${stage}: ${reason}. Нужна отдельная сверка исходника.`,
      )
  }
  issue(
    'floor-boundaries-unreviewed',
    'Границы пола помещений и балкона требуют отдельной сверки. Найденная область ещё не комната.',
  )
  issue(
    'walls-openings-unreviewed',
    'Нет полной проверенной связки стен, дверей и окон с соседними помещениями.',
  )
  issue(
    'metric-scale-unreviewed',
    scaleEvidence.commonScale.status === 'consistent'
      ? 'Согласованный масштаб размерных линий ещё не подтверждает привязку всех мерок к проверенным границам пола для переноса в сантиметры.'
      : 'Не подтверждены независимые направления масштаба и мерки для переноса в сантиметры.',
  )
  issue('vertical-data-unreviewed', 'Высоты и толщины для объёмной схемы здесь не проверены.')
  return packet
}
