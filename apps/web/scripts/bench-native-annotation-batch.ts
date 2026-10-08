// Offline batch: synthetic positive + explicitly partial, reviewed real-source exclusions.
// bun --no-env-file run apps/web/scripts/bench-native-annotation-batch.ts PDF_DIR FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  type ReviewedNativeAnnotations,
  reviewedNativeAnnotationFaces,
} from '../lib/projects/plan-native-annotation-review'
import { nativeStrokeFaceCandidates } from '../lib/projects/plan-native-stroke-candidates'
import { nativeAnnotationFixture } from './qa-native-annotation-fixture'

const [sourceDirectory, outputPath] = process.argv.slice(2)
if (!sourceDirectory || !outputPath)
  throw new Error('Supply PDF directory and fresh output directory')
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
const synthetic = nativeAnnotationFixture()
const strokes = synthetic.work.paths
  .map(
    (path) =>
      `<${path.closed ? 'polygon' : 'polyline'} points="${path.points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="#222" stroke-width="2"/>`,
  )
  .join('')
const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="white"/>${strokes}<text x="280" y="165" font-size="14">3000</text><text x="160" y="380" font-size="20">Synthetic living 420 x 355 cm</text><text x="545" y="220" font-size="14">Balcony</text></svg>`
const image = await sharp(Buffer.from(sourceSvg)).png().toBuffer()
synthetic.native.source.sha256 = createHash('sha256').update(image).digest('hex')
const original = structuredClone(synthetic)
const before = nativeStrokeFaceCandidates(synthetic)
const after = reviewedNativeAnnotationFaces(synthetic)
if (after.status !== 'draft') throw new Error(after.reason)
assert.deepEqual(synthetic, original)
assert.equal(before.candidates.length, 1)
assert.deepEqual(
  after.faces.candidates.map((candidate) => candidate.pixelArea).sort((a, b) => a - b),
  [22787.5, 149100],
)
assert.equal(after.confirmsFloorGeometry, false)
await writeFile(join(directory, 'synthetic-source.png'), image)
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">${after.faces.candidates.map((candidate) => `<polygon points="${candidate.rasterPolygon.map((point) => `${point.x},${point.y}`).join(' ')}" fill="#008888" fill-opacity="0.1" stroke="#008888" stroke-width="3"/>`).join('')}${after.excluded.map((entry) => `<line x1="${entry.start.x}" y1="${entry.start.y}" x2="${entry.end.x}" y2="${entry.end.y}" stroke="#cc0044" stroke-width="3"/>`).join('')}</svg>`
await sharp(image)
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(join(directory, 'synthetic-reviewed-overlay.png'))
await writeFile(
  join(directory, 'synthetic-result.json'),
  JSON.stringify(
    {
      synthetic: true,
      before,
      after,
      caveat:
        'Generated test strokes; no original PDF, physical obmer, openings or confirmed floor model.',
    },
    null,
    2,
  ),
)
const fixtures = JSON.parse(
  await readFile(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../docs/qa/fixtures/native-partial-annotation-review.json',
    ),
    'utf8',
  ),
) as { file: string; reviewed: ReviewedNativeAnnotations }[]
const results = []
for (const fixture of fixtures) {
  assert.match(fixture.file, /^[a-z0-9_-]+\.pdf$/)
  const body: Buffer = await readFile(join(sourceDirectory, fixture.file))
  assert.equal(createHash('sha256').update(body).digest('hex'), fixture.reviewed.source.sha256)
  const page = await preparePlanPage(body, true, fixture.reviewed.source.pdfPage, true, true)
  if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
    throw new Error('Missing native layers')
  const originalWork = structuredClone(page.linework)
  const result = reviewedNativeAnnotationFaces({
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
    reviewed: fixture.reviewed,
  })
  if (result.status !== 'draft') throw new Error(result.reason)
  assert.deepEqual(page.linework, originalWork)
  assert.equal(result.excluded.length, 1)
  assert.equal(result.searchedPathCount, result.originalPathCount - 1)
  assert.equal(result.faces.semanticStatus, 'unclassified')
  assert.equal(result.completeAnnotationInventory, false)
  const scale = page.nativeTextAnchors.pageNormalizedScale
  if (!scale) throw new Error('Missing raster mapping')
  const marks = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">${result.excluded.map((entry) => `<line x1="${entry.start.x * scale.x}" y1="${entry.start.y * scale.y}" x2="${entry.end.x * scale.x}" y2="${entry.end.y * scale.y}" stroke="#cc0044" stroke-width="5"/>`).join('')}</svg>`
  await sharp(page.image.body)
    .composite([{ input: Buffer.from(marks) }])
    .png()
    .toFile(join(directory, fixture.file.replace('.pdf', '-partial-review.png')))
  await writeFile(
    join(directory, fixture.file.replace('.pdf', '-result.json')),
    JSON.stringify(result, null, 2),
  )
  results.push({
    file: fixture.file,
    excluded: result.excluded.length,
    candidateFaces: result.faces.candidates.length,
    remainingRefusal: result.faces.refusalReason,
  })
}
await writeFile(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      syntheticFaces: 2,
      partialRealReviews: results,
      caveat: 'Partial explicit review, not automatic cleanup or accepted room recognition.',
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({ syntheticFaces: 2, partialRealReviews: results, aiRequests: 0 }, null, 2),
)
