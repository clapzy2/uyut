// Local-only coverage probe; expected room IDs are never inputs to inference.
// bun --no-env-file run apps/web/scripts/bench-native-room-corpus.ts PDF_DIR FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePlanPage } from '../lib/projects/plan-document'
import { automaticNativeRoomCandidates } from '../lib/projects/plan-native-room-candidates'
import { nativeStrokeCycleCandidates } from '../lib/projects/plan-native-stroke-candidates'

type Source = { file: string; sha256: string; existingPage: number; pages: number }
// Observed refusals on hash-pinned existing-state pages, not expected room counts.
const expectedRefusals = new Map([
  ['moscow_basis_47m2.pdf', 'unsupported-or-ambiguous-room-table'],
  ['moscow_basman_68m2.pdf', 'unsupported-or-ambiguous-room-table'],
  ['moscow_life_kutuzovsky.pdf', 'incomplete-native-geometry'],
  ['spb_designgroup.pdf', 'unsupported-or-ambiguous-room-table'],
  ['moscow_ryazansky_remplanner.pdf', 'unsupported-or-ambiguous-room-table'],
])
const [sourceDirectory, outputPath] = process.argv.slice(2)
if (!sourceDirectory || !outputPath)
  throw new Error('Supply PDF directory and fresh output directory')
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/qa/fixtures/independent-pdf-corpus.json',
)
const sources = JSON.parse(await readFile(fixturePath, 'utf8')) as Source[]
assert.deepEqual(
  sources.map((source) => source.file).sort(),
  [...expectedRefusals.keys()].sort(),
  'Corpus coverage changed; independently review the new pages before updating expectations',
)
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
const results = []
for (const source of sources) {
  assert.match(source.file, /^[a-z0-9_-]+\.pdf$/)
  const body: Buffer = await readFile(join(sourceDirectory, source.file))
  assert.equal(createHash('sha256').update(body).digest('hex'), source.sha256)
  const page = await preparePlanPage(body, true, source.existingPage, true, true)
  assert.equal(page.pageCount, source.pages)
  if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
    throw new Error(`${source.file}: missing native extraction`)
  const result = automaticNativeRoomCandidates({
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
  })
  assert.equal(result.geometry.status, 'draft')
  assert.equal(result.geometry.semanticStatus, 'unclassified')
  assert.equal(result.status, 'unresolved', `${source.file}: review newly inferred associations`)
  if (result.status !== 'unresolved') throw new Error('Unexpected automatic associations')
  assert.equal(result.reason, expectedRefusals.get(source.file))
  assert.equal(result.associations.length, 0)
  const strokes = nativeStrokeCycleCandidates({
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
  })
  assert.equal(strokes.status, 'draft')
  assert.equal(strokes.semanticStatus, 'unclassified')
  if (strokes.truncated) assert.equal(strokes.candidates.length, 0)
  await writeFile(join(directory, source.file.replace('.pdf', '-source.jpg')), page.image.body)
  await writeFile(
    join(directory, source.file.replace('.pdf', '-result.json')),
    JSON.stringify(result, null, 2),
  )
  await writeFile(
    join(directory, source.file.replace('.pdf', '-stroke-candidates.json')),
    JSON.stringify(strokes, null, 2),
  )
  const summary = {
    file: source.file,
    page: source.existingPage,
    originalSha256: source.sha256,
    status: result.status,
    reason: result.reason,
    nativeLabels: page.nativeTextAnchors.labels.length,
    nativePaths: page.linework.paths.length,
    geometryCandidates: result.geometry.candidates.length,
    geometryTruncated: result.geometry.truncated,
    associations: result.associations.length,
    refusalRegressionPassed: true,
    strokeCandidates: strokes.candidates.length,
    strokeRefusal: strokes.refusalReason,
    strokeRejectedReasons: strokes.rejected.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.reason] = (counts[entry.reason] ?? 0) + 1
      return counts
    }, {}),
  }
  results.push(summary)
  console.log(JSON.stringify(summary))
}
await writeFile(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      caveat: 'Refusal regressions, not successful room recognition or confirmed geometry.',
      results,
    },
    null,
    2,
  ),
)
