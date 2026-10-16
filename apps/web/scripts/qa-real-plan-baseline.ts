/** Source-only baseline. No model calls, project writes or geometry confirmation. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeCompositeFrameEvidence } from '../lib/projects/plan-native-composite-frames'
import { automaticNativeDimensionRoles } from '../lib/projects/plan-native-dimension-roles'
import { nativeFloorCavityCandidates } from '../lib/projects/plan-native-floor-cavities'
import {
  nativeNumberCircleCandidates,
  numberCircleSourcePaths,
} from '../lib/projects/plan-native-number-circles'
import { automaticNativeRoomCandidates } from '../lib/projects/plan-native-room-candidates'
import { nativeRoomNumberScheduleLinks } from '../lib/projects/plan-native-room-number-links'
import { nativeRoomScheduleEvidence } from '../lib/projects/plan-native-room-schedule'

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
  const rooms = automaticNativeRoomCandidates(input)
  const dimensions = automaticNativeDimensionRoles({
    ...input,
    source: { sha256, pdfPage: pageNumber, state: 'existing' },
  })
  console.log(
    JSON.stringify({
      ...base,
      nativePaths: page.linework.paths.length,
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
