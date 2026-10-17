import type { PlanPageContours, PlanReading } from '@uyut/db'
import { exactNativePointKey } from './plan-native-exact-intersections'
import type { SourcePaintBoundarySupport } from './plan-native-painted-floor-boundaries'
import type {
  nativePaintedFloorReview,
  ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import {
  nativeSourceOpeningContacts,
  type SourceOpeningInspection,
} from './plan-native-source-opening-contacts'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { findPlanPageWallBodySupports, type PdfWallBodySupport } from './plan-pdf-wall-body-support'

export type SourceFloorMaterialSupports = {
  status: 'diagnostic' | 'held'
  semanticStatus: 'unclassified'
  physicalBoundariesAccepted: false
  source: PdfPlanSource
  sourceRevision: string
  reason: string | null
  /** The bounded legacy search does not certify a complete material inventory. */
  completeInventory: false
  spans: PdfWallBodySupport[]
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
      includeSpanVisibility: input.includeSpanVisibility,
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
          : supports.filter((support) => support.contourKey === floor.sourceRoomKey),
      }
    }
    return report
  } catch {
    return hold('invalid-saved-painted-floor-review')
  }
}
