/** Source-only baseline. No model calls, project writes or geometry confirmation. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeCaptionBindings } from '../lib/projects/plan-native-caption-bindings'
import { nativeCompositeFrameEvidence } from '../lib/projects/plan-native-composite-frames'
import { automaticNativeDimensionRoles } from '../lib/projects/plan-native-dimension-roles'
import { nativeDoorSymbolCandidates } from '../lib/projects/plan-native-door-symbols'
import { nativeFloorCavityCandidates } from '../lib/projects/plan-native-floor-cavities'
import {
  nativeNumberCircleCandidates,
  numberCircleSourcePaths,
} from '../lib/projects/plan-native-number-circles'
import { automaticNativeRoomCandidates } from '../lib/projects/plan-native-room-candidates'
import { nativeRoomNumberScheduleLinks } from '../lib/projects/plan-native-room-number-links'
import { nativeRoomScheduleEvidence } from '../lib/projects/plan-native-room-schedule'
import { nativeStrokeFaceCandidates } from '../lib/projects/plan-native-stroke-candidates'

const [path, pageArgument = '1'] = process.argv.slice(2)
const pageNumber = Number(pageArgument)
if (!path || !Number.isSafeInteger(pageNumber) || pageNumber < 1) {
  throw new Error('Usage: bun run scripts/qa-real-plan-baseline.ts <source> [PDF page]')
}
const body = await readFile(path)
const sha256 = createHash('sha256').update(body).digest('hex')
const isPdf = body.subarray(0, 5).toString() === '%PDF-'
const page = await preparePlanPage(body, isPdf, pageNumber, true, true)
const base = {
  sha256,
  page: pageNumber,
  pageCount: page.pageCount,
  paidCalls: 0,
  geometryConfirmed: false,
}
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource) {
  console.log(JSON.stringify({ ...base, status: 'unresolved', reason: 'no-native-PDF-evidence' }))
} else {
  const input = {
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
  }
  const schedule = nativeRoomScheduleEvidence(input)
  const circles = nativeNumberCircleCandidates(input)
  const floors = nativeFloorCavityCandidates(input)
  const strokeFaces = nativeStrokeFaceCandidates(input)
  const doors = nativeDoorSymbolCandidates(input)
  const source = { sha256, pdfPage: pageNumber, state: 'existing' as const }
  const bindings = nativeCaptionBindings({ ...input, source })
  const rooms = automaticNativeRoomCandidates(input)
  const dimensions = automaticNativeDimensionRoles({
    ...input,
    source,
  })
  console.log(
    JSON.stringify({
      ...base,
      nativePaths: page.linework.paths.length,
      strokeFaces: {
        refusalReason: strokeFaces.refusalReason,
        candidates: strokeFaces.candidates.length,
      },
      captionBindings: {
        status: bindings.status,
        refusalReason: bindings.refusalReason,
        candidates: bindings.candidates.length,
        unresolved: bindings.unresolved.length,
      },
      nativeCurves: {
        retained: page.linework.curvePaths?.length ?? 0,
        total: page.linework.skippedCurves,
        truncated: page.linework.curvePathsTruncated,
      },
      doors: {
        status: doors.status,
        refusalReason: doors.refusalReason,
        candidates: doors.candidates.map((candidate) => ({
          id: candidate.id,
          arc: candidate.arc.operationIndex,
          leaf: candidate.leaf.operationIndex,
          physicalPassageAccepted: candidate.physicalPassageAccepted,
        })),
        rejected: doors.rejected,
        completeOpeningInventory: doors.completeOpeningInventory,
      },
      compositeRectangles: nativeCompositeFrameEvidence(
        page.linework,
        page.nativeTextAnchors.pageNormalizedScale ?? { x: 0, y: 0 },
      ),
      schedule,
      numberScheduleLinks: nativeRoomNumberScheduleLinks(input).report,
      circles: {
        ...circles,
        cues: circles.cues.map((cue) => ({
          sourceNumber: cue.sourceNumber,
          labelId: cue.labelId,
          sourcePaths: numberCircleSourcePaths(cue).map((curve) => ({
            operationIndex: curve.operationIndex,
            subpathIndex: curve.subpathIndex,
          })),
        })),
      },
      floors,
      rooms: {
        status: rooms.status,
        associations: rooms.associations,
        unresolvedSourceNumbers: rooms.status === 'draft' ? rooms.unresolvedSourceNumbers : null,
      },
      dimensions: {
        status: dimensions.status,
        candidates: dimensions.candidates.length,
        unresolved: dimensions.unresolved.length,
        refusalReason: dimensions.refusalReason,
      },
    }),
  )
}
