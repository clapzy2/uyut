// Source recognition only: no reviewed geometry inputs, provider calls or project writes.
// bun --no-env-file run apps/web/scripts/bench-native-openings.ts PDF PAGE FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeDoorSymbolCandidates } from '../lib/projects/plan-native-door-symbols'
import { nativeOpeningFrameCandidates } from '../lib/projects/plan-native-opening-frames'
import { nativeReviewPacket } from '../lib/projects/plan-native-review-packet'

const [pdfPath, pageValue, outputPath] = process.argv.slice(2)
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
const doors = nativeDoorSymbolCandidates(input)
const frames = nativeOpeningFrameCandidates(input)
const source = {
  sha256: createHash('sha256').update(body).digest('hex'),
  pdfPage: pageNumber,
  state: 'existing' as const,
}
const packet = nativeReviewPacket({ ...input, source, image: input.native.source })
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
      packet,
      caveat:
        'Automatic source symbol/frame candidates; not physical openings, complete free floor, metric proof or confirmed 2D/3D.',
    },
    null,
    2,
  ),
)
const overlays = [
  ...(packet.doorSymbols?.candidates ?? []).map((door) => {
    const commands = [
      `M ${door.arc.start.x} ${door.arc.start.y}`,
      ...door.arc.segments.map(
        (part) =>
          `C ${part.control1.x} ${part.control1.y} ${part.control2.x} ${part.control2.y} ${part.end.x} ${part.end.y}`,
      ),
    ].join(' ')
    return `<path d="${commands}" fill="none" stroke="#b06500" stroke-width="3"/><line x1="${door.leaf.start.x}" y1="${door.leaf.start.y}" x2="${door.leaf.end.x}" y2="${door.leaf.end.y}" stroke="#b06500" stroke-width="3"/>`
  }),
  ...(packet.openingFrames?.candidates ?? []).map(
    (frame) =>
      `<polygon points="${frame.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#b06500" stroke-width="3" stroke-dasharray="5 3"/>`,
  ),
].join('')
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">${overlays}</svg>`
await sharp(page.image.body)
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(resolve(directory, 'source-opening-candidates.png'))
console.log(
  JSON.stringify(
    {
      source,
      aiRequests: 0,
      doors: doors.candidates.length,
      frames: frames.candidates.length,
      doorRefusal: doors.refusalReason,
      frameRefusal: frames.refusalReason,
      skippedCurves: input.work.skippedCurves,
      clippedPaths: input.work.clippedPaths,
    },
    null,
    2,
  ),
)
