// Whole-page same-source packet gate, no mixed evidence or synthetic completeness.
// bun --no-env-file run apps/web/scripts/bench-native-review-packets.ts PDF_DIR FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeReviewPacket } from '../lib/projects/plan-native-review-packet'

const [sourceDirectory, outputPath] = process.argv.slice(2)
if (!sourceDirectory || !outputPath)
  throw new Error('Supply existing corpus directory and fresh output directory')
const sources = JSON.parse(
  await readFile(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../docs/qa/fixtures/independent-pdf-corpus.json',
    ),
    'utf8',
  ),
) as { file: string; sha256: string; existingPage: number }[]
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
const results = []
for (const source of sources) {
  assert.match(source.file, /^[a-z0-9_-]+\.pdf$/)
  const body: Buffer = await readFile(join(sourceDirectory, source.file))
  assert.equal(createHash('sha256').update(body).digest('hex'), source.sha256)
  const page = await preparePlanPage(body, true, source.existingPage, true, true)
  const image = {
    sha256: createHash('sha256').update(page.image.body).digest('hex'),
    page: page.pageNumber,
    width: page.image.width,
    height: page.image.height,
  }
  const original = structuredClone({ native: page.nativeTextAnchors, work: page.linework })
  const packet = nativeReviewPacket({
    source: { sha256: source.sha256, pdfPage: source.existingPage, state: 'existing' },
    image,
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
  })
  assert.deepEqual({ native: page.nativeTextAnchors, work: page.linework }, original)
  assert.deepEqual(packet.readiness, { readyFor2D: false, readyFor3D: false, readOnly: true })
  assert.equal(packet.coordinateSystem, 'rendered-image-pixels')
  assert.ok(packet.faces.length <= 100)
  assert.ok(packet.issues.some((issue) => issue.code === 'floor-boundaries-unreviewed'))
  await writeFile(
    join(directory, source.file.replace('.pdf', '-packet.json')),
    JSON.stringify(packet, null, 2),
  )
  results.push({
    file: source.file,
    status: packet.status,
    counts: packet.counts,
    issues: packet.issues.map((issue) => issue.code),
    bytes: Buffer.byteLength(JSON.stringify(packet)),
  })
}
assert.equal(results.length, 5)
await writeFile(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      projectWrites: 0,
      results,
      caveat: 'Whole-page inspection packets are not accepted whole-apartment recognition.',
    },
    null,
    2,
  ),
)
console.log(JSON.stringify({ aiRequests: 0, projectWrites: 0, results }, null, 2))
