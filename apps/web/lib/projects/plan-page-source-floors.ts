import type { PlanReading } from '@uyut/db'
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
  }[]
}

/** Fresh source-space reference, never a raster roundtrip or a physical contour. */
export function planPageSourceFloors(input: {
  source: PdfPlanSource
  sourceRevision: string
  pageWidth: number
  pageHeight: number
  reading: PlanReading
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
    const fresh = nativeSourceOpeningContacts({ ...input.evidence, reviewed })
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
    return report
  } catch {
    return hold('invalid-saved-painted-floor-review')
  }
}
