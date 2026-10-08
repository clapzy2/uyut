// Offline only: exact caption strings are supplied, not independently discovered by OCR.
// bun --no-env-file run apps/web/scripts/bench-native-region-labels.ts PDF PAGE FRESH_DIR CAPTION...
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import { bindObservedRegionLabels } from '../lib/projects/plan-raster-region-labels'
import { detectPlanRasterRegions } from '../lib/projects/plan-raster-regions'

const [pdfPath, pageArgument, outputPath, ...captionNames] = process.argv.slice(2)
if (!pdfPath || !pageArgument || !outputPath || captionNames.length === 0)
  throw new Error('Supply PDF, page, fresh output directory, and exact caption strings')
if (captionNames.some((name) => !name.trim() || name !== name.trim() || name.length > 120))
  throw new Error('Invalid caption string')
const pdf = await readFile(resolve(pdfPath))
const page = await preparePlanPage(pdf, true, Number(pageArgument), false, true)
const native = page.nativeTextAnchors
if (!native) throw new Error('Native anchor extraction unavailable')
const grayscale = await sharp(page.image.body).greyscale().raw().toBuffer()
const detected = detectPlanRasterRegions({
  grayscale,
  width: page.image.width,
  height: page.image.height,
})
const names = new Set(captionNames)
const labels = native.labels.filter((label) => names.has(label.name))
const missingCaptionNames = [...names].filter(
  (name) => !labels.some((label) => label.name === name),
)
const bindingRefusalReasons = [
  ...(!native.complete ? ['native-layer-incomplete'] : []),
  ...(detected.truncated ? ['region-detection-truncated'] : []),
  ...(missingCaptionNames.length > 0 ? ['missing-requested-captions'] : []),
  ...(labels.length > 50 ? ['too-many-matching-captions'] : []),
]
const binding =
  bindingRefusalReasons.length === 0
    ? bindObservedRegionLabels({
        regionSource: native.source,
        labelSource: native.source,
        regions: detected.regions,
        labels,
      })
    : null
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(resolve(directory, 'source.jpg'), page.image.body)
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      originalPdfSha256: createHash('sha256').update(pdf).digest('hex'),
      frame: native.source,
      nativeLayerComplete: native.complete,
      captionSelection: 'exact-supplied-strings-not-OCR',
      anchorMeaning: 'native-text-baseline-origin-not-glyph-box-or-room-centre',
      missingCaptionNames,
      bindingRefusalReasons,
      labels,
      detected,
      binding,
    },
    null,
    2,
  ),
)
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
  <image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
  ${detected.regions.map((region) => `<polygon points="${region.polygon.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="#008888" fill-opacity="0.08" stroke="#008888" stroke-width="2"/>`).join('')}
  ${labels.map(({ point }) => `<circle cx="${point.x}" cy="${point.y}" r="6" fill="#cc0044"/>`).join('')}
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(resolve(directory, 'overlay.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      nativeLayerComplete: native.complete,
      selectedCaptions: labels.length,
      missingCaptionNames,
      candidateRegions: detected.regions.length,
      assignments: binding?.assignments.length ?? 0,
      unresolvedCaptions: binding?.unresolvedLabelIds.length ?? labels.length,
      bindingRefused: binding === null,
      bindingRefusalReasons,
    },
    null,
    2,
  ),
)
