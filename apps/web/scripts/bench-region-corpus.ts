// Controlled offline evidence: known label positions, not OCR or measured floor geometry.
// bun --no-env-file run apps/web/scripts/bench-region-corpus.ts FRESH_OUTPUT_DIRECTORY
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { bindObservedRegionLabels } from '../lib/projects/plan-raster-region-labels'
import { detectPlanRasterRegions } from '../lib/projects/plan-raster-regions'

const [outputPath] = process.argv.slice(2)
if (!outputPath) throw new Error('Supply a fresh output directory')
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })

const knownLabels = [
  { id: 'printed-room-1', name: 'Спальня', point: { x: 150, y: 130 } },
  { id: 'printed-room-2', name: 'Спальня', point: { x: 650, y: 130 } },
]

type FixtureOptions = {
  furniture?: boolean
  openPassage?: boolean
  windowRecess?: boolean
}

function sourceSvg(options: FixtureOptions) {
  const divider = options.openPassage
    ? '<path d="M500 50V400 M500 500V650" stroke="black" stroke-width="20"/>'
    : '<path d="M500 50V650" stroke="black" stroke-width="20"/>'
  const beds = options.furniture
    ? '<rect x="250" y="250" width="140" height="240" fill="white" stroke="black" stroke-width="6"/><rect x="700" y="250" width="140" height="240" fill="white" stroke="black" stroke-width="6"/>'
    : ''
  const window = options.windowRecess
    ? '<rect x="180" y="39" width="80" height="23" fill="white"/><path d="M180 40H260" stroke="blue" stroke-width="3"/>'
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700">
    <rect width="1000" height="700" fill="white"/>
    <rect x="50" y="50" width="900" height="600" fill="white" stroke="black" stroke-width="20"/>
    ${divider}${beds}${window}
    <text x="150" y="130" font-family="sans-serif" font-size="20">1 Спальня</text>
    <text x="650" y="130" font-family="sans-serif" font-size="20">2 Спальня</text>
  </svg>`
}

const cases: { name: string; options: FixtureOptions; crop?: boolean }[] = [
  { name: 'closed-rooms', options: {} },
  { name: 'closed-rooms-with-furniture', options: { furniture: true } },
  { name: 'open-passage', options: { openPassage: true } },
  { name: 'window-recess', options: { windowRecess: true } },
  { name: 'cropped-right-room', options: {}, crop: true },
]

const summaries = []
for (const sample of cases) {
  const original = await sharp(Buffer.from(sourceSvg(sample.options)))
    .png()
    .toBuffer()
  const body = sample.crop
    ? await sharp(original).extract({ left: 0, top: 0, width: 700, height: 700 }).png().toBuffer()
    : original
  const gray = await sharp(body).greyscale().raw().toBuffer({ resolveWithObject: true })
  const frame = {
    sha256: createHash('sha256').update(body).digest('hex'),
    width: gray.info.width,
    height: gray.info.height,
    page: 1,
  }
  const detected = detectPlanRasterRegions({
    grayscale: gray.data,
    width: frame.width,
    height: frame.height,
  })
  assert.equal(detected.truncated, false, `${sample.name}: detector must finish`)
  const binding = bindObservedRegionLabels({
    regionSource: frame,
    labelSource: frame,
    regions: detected.regions,
    labels: knownLabels,
  })
  assert.equal(binding.status, 'draft')

  const assignedRegions = binding.assignments.map((assignment) => {
    const region = detected.regions.find((candidate) => candidate.id === assignment.regionId)
    assert.ok(region, `${sample.name}: assigned region must exist`)
    return { labelId: assignment.labelId, ...region }
  })
  if (sample.name === 'open-passage') {
    assert.equal(binding.assignments.length, 0)
    assert.deepEqual(new Set(binding.unresolvedLabelIds), new Set(knownLabels.map(({ id }) => id)))
    assert.equal(binding.ambiguities.length, 1)
    assert.deepEqual(
      new Set(binding.ambiguities[0]?.labelIds),
      new Set(knownLabels.map(({ id }) => id)),
    )
  } else if (sample.crop) {
    assert.equal(binding.assignments.length, 1)
    assert.equal(binding.assignments[0]?.labelId, 'printed-room-1')
    assert.deepEqual(binding.unresolvedLabelIds, ['printed-room-2'])
    assert.ok(detected.frameIgnoredComponents >= 2, 'outside and cut room must be excluded')
  } else {
    assert.equal(binding.assignments.length, 2)
    assert.equal(new Set(binding.assignments.map(({ regionId }) => regionId)).size, 2)
    assert.equal(binding.unresolvedLabelIds.length, 0)
    const left = assignedRegions.find(({ labelId }) => labelId === 'printed-room-1')
    const right = assignedRegions.find(({ labelId }) => labelId === 'printed-room-2')
    assert.ok(left && right)
    assert.ok(left.bounds.maxX <= 490 && right.bounds.minX >= 510)
    assert.ok(left.pixelArea > 200_000 && right.pixelArea > 200_000)
    if (sample.options.furniture) {
      assert.equal(detected.regions.length, 4)
      assert.equal(binding.ignoredRegionIds.length, 2)
      assert.ok(left.hasInteriorIslands && right.hasInteriorIslands)
      for (const id of binding.ignoredRegionIds) {
        const candidate = detected.regions.find((region) => region.id === id)
        assert.ok(candidate && candidate.pixelArea < 40_000, 'bed interiors must remain unnamed')
      }
    }
    if (sample.options.windowRecess) {
      assert.ok(left.bounds.minY < 60, 'bright component includes the window reveal')
    }
  }

  const caveat = sample.options.windowRecess
    ? 'The bright component extends into the window reveal: it is not exact floor geometry.'
    : sample.options.furniture
      ? 'Furniture interiors are extra unnamed candidates; ink islands are not measured floor holes.'
      : sample.options.openPassage
        ? 'An open passage merges bright regions; competing labels remain unresolved.'
        : sample.crop
          ? 'A frame-touching room is excluded rather than closed using the crop edge.'
          : 'Known label points bind draft candidates; this does not verify metric room dimensions.'
  const result = {
    name: sample.name,
    frame,
    labelOrigin: 'controlled-fixture-not-OCR',
    caveat,
    detected,
    binding,
  }
  await writeFile(resolve(directory, `${sample.name}-source.png`), body)
  await writeFile(resolve(directory, `${sample.name}.json`), JSON.stringify(result, null, 2))
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}">
    <image width="${frame.width}" height="${frame.height}" href="data:image/png;base64,${body.toString('base64')}"/>
    ${detected.regions.map((region) => `<polygon points="${region.polygon.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="#008888" fill-opacity="0.12" stroke="#008888" stroke-width="2"/>`).join('')}
    ${knownLabels.map(({ point }) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#cc0044"/>`).join('')}
  </svg>`
  await sharp(Buffer.from(overlay))
    .png()
    .toFile(resolve(directory, `${sample.name}-overlay.png`))
  summaries.push({
    name: sample.name,
    regions: detected.regions.length,
    assignments: binding.assignments.length,
    unresolved: binding.unresolvedLabelIds.length,
    ignored: binding.ignoredRegionIds.length,
    ambiguities: binding.ambiguities.length,
    caveat,
  })
}
await writeFile(
  resolve(directory, 'results.json'),
  JSON.stringify({ aiRequests: 0, summaries }, null, 2),
)
console.log(JSON.stringify({ aiRequests: 0, summaries }, null, 2))
