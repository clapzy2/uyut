// Offline source-reviewed sections, not automatic walls or certified opening types.
// bun --no-env-file run apps/web/scripts/bench-native-wall-sections.ts PDF_DIR FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeWallSectionGaps } from '../lib/projects/plan-native-wall-section'
import type { PagePoint } from '../lib/projects/plan-pdf-linework'
import type { PerimeterProbe } from './qa-pdf-perimeter'

const [sourceDirectory, outputPath] = process.argv.slice(2)
if (!sourceDirectory || !outputPath)
  throw new Error('Supply PDF directory and fresh output directory')
const sources = JSON.parse(
  await readFile(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../docs/qa/fixtures/independent-pdf-corpus.json',
    ),
    'utf8',
  ),
) as {
  file: string
  sha256: string
  existingPage: number
  perimeterProbes?: PerimeterProbe[]
  standaloneDimensions?: { label: { index: number }; wallAnchors?: { point: PagePoint }[] }[]
}[]
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
const results = []
const observedSections: string[] = []
const expectedSections = [
  'moscow_basman_68m2.pdf:top',
  'moscow_basman_68m2.pdf:right',
  'moscow_basman_68m2.pdf:bottom',
  'moscow_basman_68m2.pdf:left',
  'moscow_ryazansky_remplanner.pdf:left',
  'moscow_ryazansky_remplanner.pdf:right',
  'moscow_ryazansky_remplanner.pdf:entry',
]
const expectedRefusals = new Map([
  ['moscow_basman_68m2.pdf:top', 'omitted-geometry-at-section'],
  ['moscow_basman_68m2.pdf:bottom', 'omitted-geometry-at-section'],
])
for (const source of sources.filter((source) => source.perimeterProbes?.length)) {
  assert.match(source.file, /^[a-z0-9_-]+\.pdf$/)
  const body: Buffer = await readFile(join(sourceDirectory, source.file))
  assert.equal(createHash('sha256').update(body).digest('hex'), source.sha256)
  const page = await preparePlanPage(body, true, source.existingPage, true, true)
  if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
    throw new Error('Missing native layers')
  const original = structuredClone(page.linework)
  const sections = []
  for (const probe of source.perimeterProbes ?? []) {
    const result = nativeWallSectionGaps({
      native: page.nativeTextAnchors,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
      reviewed: {
        review: 'manual-native-wall-section-review',
        source: { sha256: source.sha256, pdfPage: source.existingPage, state: 'existing' },
        rasterSource: page.nativeTextAnchors.source,
        axis: probe.axis,
        at: probe.at,
        from: probe.from,
        to: probe.to,
        // Roles come from the pre-existing independently reviewed fixture, not from paint colour.
        walls: probe.wallFillOperations.map((operationIndex) => {
          const paths = page.linework?.paths.filter(
            (path) => path.operationIndex === operationIndex,
          )
          const path = paths?.[0]
          if (paths?.length !== 1 || !path)
            throw new Error('Reviewed source wall is missing/compound')
          return {
            operationIndex,
            subpathIndex: path.subpathIndex,
            polygon: structuredClone(path.points),
          }
        }),
      },
    })
    assert.equal(result.closesFloorBoundary, false)
    assert.equal(result.confirmsOpeningKind, false)
    assert.deepEqual(page.linework, original)
    const sectionKey = `${source.file}:${probe.side}`
    observedSections.push(sectionKey)
    assert.equal(
      result.refusalReason,
      expectedRefusals.get(sectionKey) ?? null,
      `${sectionKey}: source refusal changed; review before updating expectations`,
    )
    if (!result.refusalReason) {
      assert.equal(
        result.gaps.length,
        probe.openingLabelIndexes.length,
        `${source.file}:${probe.side} gap inventory changed`,
      )
      const along = probe.axis === 'width' ? 'x' : 'y'
      const intervals = probe.openingLabelIndexes
        .map((index) => {
          const anchors = source.standaloneDimensions?.find(
            (entry) => entry.label.index === index,
          )?.wallAnchors
          if (anchors?.length !== 2)
            throw new Error('Missing independently reviewed opening wall anchors')
          return {
            from: Math.min(...anchors.map((anchor) => anchor.point[along])),
            to: Math.max(...anchors.map((anchor) => anchor.point[along])),
          }
        })
        .sort((a, b) => a.from - b.from)
      result.gaps.forEach((gap, index) => {
        const expected = intervals[index]
        if (!expected) throw new Error('Missing expected reviewed gap')
        assert.ok(
          Math.abs(gap.from - expected.from) <= probe.gapBoundaryTolerance &&
            Math.abs(gap.to - expected.to) <= probe.gapBoundaryTolerance,
          `${sectionKey}: gap endpoints changed`,
        )
        assert.equal(gap.boundedByReviewedWalls, true)
      })
    }
    sections.push({ side: probe.side, probe, result })
  }
  await writeFile(
    join(directory, source.file.replace('.pdf', '-sections.json')),
    JSON.stringify(
      { wallRoleInput: 'existing-source-reviewed-perimeter-fixture', sections },
      null,
      2,
    ),
  )
  const scale = page.nativeTextAnchors.pageNormalizedScale
  if (!scale) throw new Error('Missing source raster mapping')
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">${sections.flatMap(({ result }) => result.gaps.map((gap) => `<line x1="${gap.start.x * scale.x}" y1="${gap.start.y * scale.y}" x2="${gap.end.x * scale.x}" y2="${gap.end.y * scale.y}" stroke="${gap.unknownFillOperations.length ? '#cc0044' : '#008888'}" stroke-width="5"/>`)).join('')}</svg>`
  await sharp(page.image.body)
    .composite([{ input: Buffer.from(overlay) }])
    .png()
    .toFile(join(directory, source.file.replace('.pdf', '-section-gaps.png')))
  results.push({
    file: source.file,
    sections: sections.map(({ side, result }) => ({
      side,
      gaps: result.gaps.length,
      bounded: result.gaps.filter((gap) => gap.boundedByReviewedWalls).length,
      exactPrintedSpans: result.gaps.filter((gap) => gap.printedWidthMm !== null).length,
      refusal: result.refusalReason,
    })),
  })
}
assert.deepEqual(observedSections, expectedSections)
await writeFile(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      results,
      caveat:
        'Selected reviewed sections only; no complete walls, opening kinds, room closure, metric or 3D confirmation.',
    },
    null,
    2,
  ),
)
console.log(JSON.stringify({ aiRequests: 0, results }, null, 2))
