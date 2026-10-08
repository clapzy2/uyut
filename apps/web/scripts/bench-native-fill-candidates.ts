// Automatic geometry candidates + separately reviewed numeric label IDs, not OCR/room approval.
// bun --no-env-file run apps/web/scripts/bench-native-fill-candidates.ts PDF FRESH_DIR
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeFillCandidates } from '../lib/projects/plan-native-fill-candidates'
import {
  bindReviewedNumberedCaptions,
  type ReviewedNumberedCaptions,
} from '../lib/projects/plan-numbered-region-labels'

const [pdfPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !outputPath) throw new Error('Supply controlled PDF and fresh directory')
const reviewed: ReviewedNumberedCaptions = JSON.parse(
  await readFile('docs/qa/fixtures/apartment-native-reviewed-captions.json', 'utf8'),
)
const page = await preparePlanPage(
  await readFile(resolve(pdfPath)),
  true,
  reviewed.source.page,
  true,
  true,
)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Missing native evidence')
const detected = nativeFillCandidates({
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
})
assert.equal(detected.truncated, false)
assert.equal(detected.candidates.length, 19, 'controlled native paint inventory')
const binding = bindReviewedNumberedCaptions({
  native: page.nativeTextAnchors,
  regionSource: detected.source,
  reviewed,
  regions: detected.candidates.map((candidate) => ({
    id: candidate.id,
    polygon: candidate.rasterPolygon,
  })),
})
assert.equal(binding.assignments.length, 8, 'controlled reviewed marker inventory')
assert.equal(binding.ignoredRegionIds.length, 11, 'unclassified and unused candidates retained')
for (const [id, file] of [
  ['native-fill-2510:0', 'chigintseva-existing-bedroom-02.json'],
  ['native-fill-2720:0', 'chigintseva-existing-balcony-08.json'],
]) {
  if (!id || !file) throw new Error('Missing fixture pair')
  const expected = JSON.parse(await readFile(resolve('docs/qa/fixtures', file), 'utf8'))
  assert.equal(expected.source.sha256, detected.originalPdfSha256)
  assert.equal(expected.source.pdfPage, detected.source.page)
  assert.deepEqual(
    detected.candidates.find((candidate) => candidate.id === id)?.polygon,
    expected.room.polygon,
  )
}
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      detected,
      binding,
      caveat:
        'Colour is only a hint; reviewed number IDs are not automatic OCR, and named fills are not confirmed floors.',
    },
    null,
    2,
  ),
)
const assignedIds = new Set(binding.assignments.map((assignment) => assignment.regionId))
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
  <image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
  ${detected.candidates.map((candidate) => `<polygon points="${candidate.rasterPolygon.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="${assignedIds.has(candidate.id) ? '#008888' : '#999999'}" fill-opacity="0.06" stroke="${assignedIds.has(candidate.id) ? '#008888' : '#999999'}" stroke-width="2"/>`).join('')}
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(resolve(directory, 'native-fill-candidates.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      automaticCandidates: detected.candidates.length,
      reviewedCaptionAssignments: binding.assignments.length,
      ignoredCandidates: binding.ignoredRegionIds.length,
      unresolvedSourceNumbers: binding.unresolvedSourceNumbers,
      independentBedroomAndBalconyMatched: true,
    },
    null,
    2,
  ),
)
