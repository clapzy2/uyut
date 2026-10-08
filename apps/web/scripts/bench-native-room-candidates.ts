// End-to-end automatic native table/box/fill candidates; no reviewed IDs are INPUTS.
// bun --no-env-file run apps/web/scripts/bench-native-room-candidates.ts PDF FRESH_DIR
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { automaticNativeRoomCandidates } from '../lib/projects/plan-native-room-candidates'

const [pdfPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !outputPath) throw new Error('Supply controlled PDF and fresh directory')
const page = await preparePlanPage(await readFile(resolve(pdfPath)), true, 3, true, true)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Missing native layers')
const result = automaticNativeRoomCandidates({
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
})
if (result.status !== 'draft') throw new Error(result.reason)
assert.equal(result.geometry.candidates.length, 19)
assert.equal(result.associations.length, 8)
assert.deepEqual(result.unresolvedSourceNumbers, [])
// Existing reviewed IDs are read only AFTER inference, as an independent expected result.
const expected = JSON.parse(
  await readFile('docs/qa/fixtures/apartment-native-reviewed-captions.json', 'utf8'),
)
assert.deepEqual(expected.source, page.nativeTextAnchors.source)
for (const association of result.associations) {
  const marker = expected.markers.find(
    (entry: { sourceNumber: number }) => entry.sourceNumber === association.sourceNumber,
  )
  const row = expected.rows.find(
    (entry: { sourceNumber: number }) => entry.sourceNumber === association.sourceNumber,
  )
  assert.equal(association.markerLabelId, marker?.labelId)
  assert.equal(association.numberLabelId, row?.numberLabelId)
  assert.equal(association.nameLabelId, row?.nameLabelId)
}
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      result,
      independentReviewedIdsMatched: true,
      caveat:
        'Automatic native cue associations, not OCR, manual approval, confirmed free floor or complete apartment geometry.',
    },
    null,
    2,
  ),
)
const assigned = new Set(result.associations.map((entry) => entry.regionId))
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
  <image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
  ${result.geometry.candidates
    .filter((candidate) => assigned.has(candidate.id))
    .map(
      (candidate) =>
        `<polygon points="${candidate.rasterPolygon.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="#008888" fill-opacity="0.08" stroke="#008888" stroke-width="2"/>`,
    )
    .join('')}
  ${result.associations
    .map((entry) => {
      const point = page.nativeTextAnchors?.labels.find(
        (label) => label.id === entry.markerLabelId,
      )?.point
      return point ? `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#cc0044"/>` : ''
    })
    .join('')}
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(resolve(directory, 'automatic-room-candidates.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      automaticAssociations: result.associations.map(({ sourceNumber, name, regionId }) => ({
        sourceNumber,
        name,
        regionId,
      })),
      independentReviewedIdsMatched: true,
    },
    null,
    2,
  ),
)
