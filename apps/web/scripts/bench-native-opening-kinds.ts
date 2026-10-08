// Explicit reviewed source-kind declarations; no automatic symbol/type recognition.
// bun --no-env-file run apps/web/scripts/bench-native-opening-kinds.ts PDF_DIR FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { reviewedNativeOpeningKinds } from '../lib/projects/plan-native-opening-kind-review'
import {
  nativeWallSectionGaps,
  type ReviewedNativeWallSection,
} from '../lib/projects/plan-native-wall-section'
import type { PagePoint } from '../lib/projects/plan-pdf-linework'
import type { PdfPlanSource } from '../lib/projects/plan-pdf-room-binding'
import type { RegionLabelFrame } from '../lib/projects/plan-raster-region-labels'
import type { PerimeterProbe } from './qa-pdf-perimeter'

const [sourceDirectory, outputPath] = process.argv.slice(2)
if (!sourceDirectory || !outputPath)
  throw new Error('Supply PDF directory and fresh output directory')
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/qa/fixtures')
const reviewed = JSON.parse(
  await readFile(join(fixtures, 'native-opening-kind-reviews.json'), 'utf8'),
) as {
  file: string
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  declarations: {
    id: string
    side: string
    kind: 'door' | 'window'
    from: number
    to: number
    sourceDimensionIndex: number
    symbolOperations: number[]
  }[]
}
const corpus = JSON.parse(
  await readFile(join(fixtures, 'independent-pdf-corpus.json'), 'utf8'),
) as {
  file: string
  sha256: string
  perimeterProbes?: PerimeterProbe[]
  standaloneDimensions?: {
    label: { index: number }
    axis: 'width' | 'depth'
    opening?: { kind: string; probeAcross: number }
    wallAnchors?: { point: PagePoint }[]
  }[]
}[]
const source = corpus.find((source) => source.file === reviewed.file)
assert.match(reviewed.file, /^[a-z0-9_-]+\.pdf$/)
assert.equal(source?.sha256, reviewed.source.sha256)
const body: Buffer = await readFile(join(sourceDirectory, reviewed.file))
assert.equal(createHash('sha256').update(body).digest('hex'), reviewed.source.sha256)
const page = await preparePlanPage(body, true, reviewed.source.pdfPage, true, true)
if (!page.linework || !page.nativeTextAnchors || !page.lineworkRasterSource)
  throw new Error('Missing native layers')
assert.deepEqual(page.nativeTextAnchors.source, reviewed.rasterSource)
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
const original = structuredClone(page.linework),
  results = []
for (const probe of source?.perimeterProbes ?? []) {
  const declarations = reviewed.declarations.filter((entry) => entry.side === probe.side)
  if (!declarations.length) continue
  const section: ReviewedNativeWallSection = {
    review: 'manual-native-wall-section-review',
    source: reviewed.source,
    rasterSource: reviewed.rasterSource,
    axis: probe.axis,
    at: probe.at,
    from: probe.from,
    to: probe.to,
    walls: probe.wallFillOperations.map((operationIndex) => {
      const matches = page.linework?.paths.filter((path) => path.operationIndex === operationIndex),
        path = matches?.[0]
      if (matches?.length !== 1 || !path) throw new Error('Missing reviewed wall')
      return {
        operationIndex,
        subpathIndex: path.subpathIndex,
        polygon: structuredClone(path.points),
      }
    }),
  }
  const gaps = nativeWallSectionGaps({
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
    reviewed: section,
  })
  if (gaps.refusalReason) throw new Error(gaps.refusalReason)
  const items = declarations.map((declaration) => {
    // Kind authority is the earlier independent source review, not gap shape/paint colour.
    const authority = source?.standaloneDimensions?.find(
      (entry) => entry.label.index === declaration.sourceDimensionIndex,
    )
    assert.equal(authority?.opening?.kind, declaration.kind)
    assert.equal(authority?.axis, probe.axis)
    assert.equal(authority?.opening?.probeAcross, probe.at)
    if (authority?.wallAnchors?.length !== 2)
      throw new Error('Missing independent opening wall anchors')
    const along = probe.axis === 'width' ? 'x' : 'y'
    assert.equal(
      Math.min(...authority.wallAnchors.map((anchor) => anchor.point[along])),
      declaration.from,
    )
    assert.equal(
      Math.max(...authority.wallAnchors.map((anchor) => anchor.point[along])),
      declaration.to,
    )
    const gap = gaps.gaps.find((gap) => gap.from === declaration.from && gap.to === declaration.to)
    if (!gap) throw new Error('Reviewed gap coordinates changed')
    const symbols = declaration.symbolOperations.map((operationIndex) => {
      const paths = page.linework?.paths.filter((path) => path.operationIndex === operationIndex),
        path = paths?.[0]
      if (paths?.length !== 1 || !path) throw new Error('Reviewed symbol missing/compound')
      return structuredClone(path)
    })
    return { id: declaration.id, kind: declaration.kind, gap: structuredClone(gap), symbols }
  })
  const result = reviewedNativeOpeningKinds({
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
    reviewed: { review: 'manual-native-opening-kind-review', section, items },
  })
  if (result.status !== 'draft') throw new Error(result.reason)
  assert.equal(result.bindings.length, declarations.length)
  assert.equal(result.closesFloorBoundary, false)
  assert.deepEqual(page.linework, original)
  for (const binding of result.bindings) {
    assert.equal(binding.physicalPassageAccepted, false)
    assert.equal(binding.gap.openingKind, null)
    assert.ok(binding.gap.unknownFillOperations.length > 0)
  }
  results.push(result)
}
assert.equal(results.flatMap((result) => result.bindings).length, 5)
const scale = page.nativeTextAnchors.pageNormalizedScale
if (!scale) throw new Error('Missing raster mapping')
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">${results.flatMap((result) => result.bindings.map((binding) => `<line x1="${binding.gap.start.x * scale.x}" y1="${binding.gap.start.y * scale.y}" x2="${binding.gap.end.x * scale.x}" y2="${binding.gap.end.y * scale.y}" stroke="${binding.sourceReviewedKind === 'window' ? '#008888' : '#cc0044'}" stroke-width="5"/>`)).join('')}</svg>`
await sharp(page.image.body)
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(join(directory, 'source-reviewed-kinds.png'))
await writeFile(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      results,
      caveat:
        'Five explicit source-kind reviews, not automatic detection, free passage, room contours or confirmed 2D/3D.',
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({
    sourceReviewedWindows: results
      .flatMap((result) => result.bindings)
      .filter((binding) => binding.sourceReviewedKind === 'window').length,
    sourceReviewedDoors: results
      .flatMap((result) => result.bindings)
      .filter((binding) => binding.sourceReviewedKind === 'door').length,
    acceptedPhysicalPassages: 0,
    aiRequests: 0,
  }),
)
