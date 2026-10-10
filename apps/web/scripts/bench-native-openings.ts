// Automatic symbol recognition is independent of any optional archived manual review.
// No provider calls or project writes.
// bun --no-env-file run apps/web/scripts/bench-native-openings.ts PDF PAGE FRESH_DIR [SAVED_READING_JSON]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeFloorCavityCandidates } from '../lib/projects/plan-native-floor-cavities'
import { nativeFloorOpeningSides } from '../lib/projects/plan-native-floor-opening-sides'
import { nativeOpeningSourceLinks } from '../lib/projects/plan-native-opening-links'
import { nativeReviewPacket } from '../lib/projects/plan-native-review-packet'
import { nativeReviewedFrameRooms } from '../lib/projects/plan-native-reviewed-frame-rooms'
import { nativeRoomNumberScheduleLinks } from '../lib/projects/plan-native-room-number-links'

const [pdfPath, pageValue, outputPath, savedReadingPath] = process.argv.slice(2)
const pageNumber = Number(pageValue)
if (!pdfPath || !outputPath || !Number.isSafeInteger(pageNumber) || pageNumber < 1)
  throw new Error('Supply PDF, selected page and fresh output directory')
const body = await readFile(resolve(pdfPath))
const page = await preparePlanPage(body, true, pageNumber, true, true)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Native source layers unavailable')
const input = {
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
}
const before = structuredClone(input)
const connections = nativeOpeningSourceLinks(input)
const doors = connections.doorSymbols
const frames = connections.openingFrames
const source = {
  sha256: createHash('sha256').update(body).digest('hex'),
  pdfPage: pageNumber,
  state: 'existing' as const,
}
// A caller may explicitly inspect an archived manual review. It is NOT an input
// to the automatic symbol recognizers or a golden set of accepted floor geometry.
const savedReading = savedReadingPath
  ? JSON.parse(await readFile(resolve(savedReadingPath), 'utf8'))
  : undefined
const scheduleNumbers = nativeRoomNumberScheduleLinks(input)
const circles = scheduleNumbers.circles
const floor = nativeFloorCavityCandidates(input)
const floorOpeningSides = nativeFloorOpeningSides(floor, connections)
const frameRooms = nativeReviewedFrameRooms({ ...input, source, reading: savedReading })
const packet = nativeReviewPacket({ ...input, source, image: input.native.source, savedReading })
assert.deepEqual(input, before)
assert.equal(packet.readiness.readOnly, true)
assert.equal(packet.readiness.readyFor2D, false)
assert.equal(packet.readiness.readyFor3D, false)
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(resolve(directory, 'source-page.jpg'), page.image.body)
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    {
      source,
      image: input.native.source,
      aiRequests: 0,
      omissions: {
        skippedCurves: input.work.skippedCurves,
        clippedPaths: input.work.clippedPaths,
        retainedCurvePaths: input.work.curvePaths?.length ?? 0,
      },
      doors,
      frames,
      connections,
      circles,
      roomScheduleEvidence: scheduleNumbers.schedule,
      numberScheduleLinks: scheduleNumbers.report,
      floor,
      floorOpeningSides,
      frameRooms,
      packet,
      caveat:
        'Automatic source symbol/frame candidates. Optional frame-room matches are correspondence to an archived manual review, not automatic room ownership, physical openings, complete free floor, metric proof or confirmed 2D/3D.',
    },
    null,
    2,
  ),
)
const sourceLine = (
  line: { start: { x: number; y: number }; end: { x: number; y: number } },
  color: string,
) =>
  `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" stroke="${color}" stroke-width="3"/>`
const overlays = [
  ...(packet.doorSymbols?.candidates ?? []).map((door) => {
    const commands = [
      `M ${door.arc.start.x} ${door.arc.start.y}`,
      ...door.arc.segments.map(
        (part) =>
          `C ${part.control1.x} ${part.control1.y} ${part.control2.x} ${part.control2.y} ${part.end.x} ${part.end.y}`,
      ),
    ].join(' ')
    return `<path d="${commands}" fill="none" stroke="#b06500" stroke-width="3"/>${(door.leafParts ?? [door.leaf]).map((part) => sourceLine(part, '#b06500')).join('')}`
  }),
  ...(packet.openingFrames?.candidates ?? []).map(
    (frame) =>
      `<polygon points="${frame.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#b06500" stroke-width="3" stroke-dasharray="5 3"/>`,
  ),
  ...(packet.glazingSymbols?.candidates ?? []).map(
    (symbol) =>
      `${symbol.polygons.map((polygon) => `<polygon points="${polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#256e98" stroke-width="2"/>`).join('')}${sourceLine(symbol.centerline, '#256e98')}`,
  ),
].join('')
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">${overlays}</svg>`
await sharp(page.image.body)
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(resolve(directory, 'source-opening-candidates.png'))
const raster = (point: { x: number; y: number }) => ({
  x: point.x * (input.native.pageNormalizedScale?.x ?? 1),
  y: point.y * (input.native.pageNormalizedScale?.y ?? 1),
})
const floorOutlines = floor.cavities
  .filter((cell) => cell.markerLabelIds.length)
  .map(
    (cell) =>
      `<polygon points="${cell.polygon
        .map(raster)
        .map((point) => `${point.x},${point.y}`)
        .join(' ')}" fill="none" stroke="#047857" stroke-width="3"/>`,
  )
const thresholdOutlines = floor.thresholds.map(
  (threshold) =>
    `<polygon points="${threshold.polygon
      .map(raster)
      .map((point) => `${point.x},${point.y}`)
      .join(' ')}" fill="none" stroke="#7c3aed" stroke-width="3" stroke-dasharray="5 3"/>`,
)
const floorOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">${[...floorOutlines, ...thresholdOutlines].join('')}</svg>`
await sharp(page.image.body)
  .composite([{ input: Buffer.from(floorOverlay) }])
  .png()
  .toFile(resolve(directory, 'source-floor-candidates.png'))
console.log(
  JSON.stringify(
    {
      source,
      aiRequests: 0,
      doors: doors.candidates.length,
      frames: frames.candidates.length,
      glazingPanels: packet.glazingSymbols?.candidates.length ?? 0,
      compoundPanelRefusal: doors.compoundPanels.refusalReason,
      sourceLinkedDoors: connections.doorLinks.filter((link) => link.status === 'linked').length,
      glazingWithTwoSourceContacts: connections.glazingLinks.filter(
        (link) => link.status === 'two-sided',
      ).length,
      sourceSymbolGroups: connections.groups.length,
      sourceLinkRefusal: connections.refusalReason,
      numericCircleCues: circles.cues.length,
      documentaryRoomRows: scheduleNumbers.report.rows.length,
      tableLinkedNumericRows: scheduleNumbers.report.rows.filter(
        (row) => row.markerStatus === 'linked',
      ).length,
      scheduleRefusal: scheduleNumbers.report.refusalReason,
      floorCavityRefusal: floor.refusalReason,
      sourceBackedCavities: floor.cavities.length,
      numberedCavities: floor.cavities.filter((cell) => cell.markerLabelIds.length).length,
      sourceLeaderBindings: floor.markerLeaders.length,
      twoSidedFloorFrames: floorOpeningSides.frames.filter((frame) => frame.status === 'two-sided')
        .length,
      oneSidedFloorFrames: floorOpeningSides.frames.filter((frame) => frame.status === 'one-sided')
        .length,
      unresolvedFloorMarkers: floor.unresolvedMarkerLabelIds.length,
      sourceThresholdStrips: floor.thresholds.length,
      sourceProfileClosures: floor.closures.length,
      unprovedCavities: floor.unprovedCavityCount,
      savedFrameReview: frameRooms.status,
      twoReviewedSides: frameRooms.frames.filter((frame) => frame.status === 'two-reviewed-sides')
        .length,
      oneReviewedSide: frameRooms.frames.filter((frame) => frame.status === 'one-reviewed-side')
        .length,
      coincidentReviewedSides: frameRooms.frames.filter(
        (frame) => frame.status === 'coincident-sides',
      ).length,
      doorRefusal: doors.refusalReason,
      frameRefusal: frames.refusalReason,
      skippedCurves: input.work.skippedCurves,
      clippedPaths: input.work.clippedPaths,
    },
    null,
    2,
  ),
)
