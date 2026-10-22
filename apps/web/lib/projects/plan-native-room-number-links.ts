import type { NativeTextAnchors } from './plan-document'
import { nativeNumberCircleCandidates } from './plan-native-number-circles'
import { nativeRoomScheduleEvidence } from './plan-native-room-schedule'
import type { PdfLinework } from './plan-pdf-linework'

export type NativeRoomScheduleReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  rows: {
    sourceNumber: number
    name: string
    documentaryAreaM2: number
    numberLabelId: string
    nameLabelId: string
    areaLabelId: string
    areaUnitLabelId?: string
    markerStatus: 'linked' | 'ambiguous' | 'unobserved' | 'unavailable'
    markerLabelIds: string[]
  }[]
  unlistedMarkerLabelIds: string[]
}

/** Documentary table-to-number links, never a room polygon or floor owner. */
export function nativeRoomNumberScheduleLinks(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: NativeTextAnchors['source']
}) {
  // Both inventories are recomputed from the same source; callers cannot inject
  // accepted table rows, marker IDs or reviewed room ownership.
  const schedule = nativeRoomScheduleEvidence(input)
  const circles = nativeNumberCircleCandidates(input)
  const report: NativeRoomScheduleReport = {
    status: schedule.status,
    refusalReason: schedule.reason,
    rows: [],
    unlistedMarkerLabelIds: [],
  }
  if (schedule.status === 'draft') {
    const tableNumbers = new Set(schedule.rows.map((row) => row.sourceNumber))
    report.rows = schedule.rows.map((row) => {
      const markerLabelIds = circles.cues
        .filter((cue) => cue.sourceNumber === row.sourceNumber)
        .map((cue) => cue.labelId)
      const markerStatus: NativeRoomScheduleReport['rows'][number]['markerStatus'] =
        circles.status === 'unresolved'
          ? 'unavailable'
          : markerLabelIds.length === 1
            ? 'linked'
            : markerLabelIds.length > 1
              ? 'ambiguous'
              : 'unobserved'
      return {
        sourceNumber: row.sourceNumber,
        name: row.name,
        documentaryAreaM2: row.documentaryAreaM2,
        numberLabelId: row.numberLabelId,
        nameLabelId: row.nameLabelId,
        areaLabelId: row.areaLabelId,
        ...(row.areaUnitLabelId ? { areaUnitLabelId: row.areaUnitLabelId } : {}),
        markerStatus,
        markerLabelIds,
      }
    })
    report.unlistedMarkerLabelIds = circles.cues
      .filter((cue) => !tableNumbers.has(cue.sourceNumber))
      .map((cue) => cue.labelId)
  }
  return {
    report,
    schedule,
    circles,
    readOnly: true as const,
    roomOwnershipConfirmed: false as const,
    closesFloorBoundary: false as const,
  }
}
