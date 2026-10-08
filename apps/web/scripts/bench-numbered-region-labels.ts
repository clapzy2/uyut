// Explicitly reviewed native IDs; not automatic table detection, OCR or metric acceptance.
// bun --no-env-file run apps/web/scripts/bench-numbered-region-labels.ts PDF REVIEW_JSON FRESH_DIR
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  bindReviewedNumberedCaptions,
  type ReviewedNumberedCaptions,
} from '../lib/projects/plan-numbered-region-labels'
import { detectPlanRasterRegions } from '../lib/projects/plan-raster-regions'

const [pdfPath, reviewPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !reviewPath || !outputPath)
  throw new Error('Supply PDF, reviewed text ID JSON, and fresh output directory')
const reviewed: ReviewedNumberedCaptions = JSON.parse(await readFile(resolve(reviewPath), 'utf8'))
const page = await preparePlanPage(
  await readFile(resolve(pdfPath)),
  true,
  reviewed.source.page,
  false,
  true,
)
const native = page.nativeTextAnchors
if (!native) throw new Error('Native text anchors unavailable')
const grayscale = await sharp(page.image.body).greyscale().raw().toBuffer()
const detected = detectPlanRasterRegions({
  grayscale,
  width: page.image.width,
  height: page.image.height,
  probes: reviewed.markers.map((marker) => {
    const label = native.labels.find((label) => label.id === marker.labelId)
    if (!label) throw new Error('Reviewed marker is absent from native text')
    return { id: label.id, point: label.point }
  }),
})
if (detected.truncated) throw new Error('Truncated raster candidate inventory')
const binding = bindReviewedNumberedCaptions({
  regionSource: native.source,
  regions: detected.regions,
  native,
  reviewed,
  pixelMembership: { source: native.source, points: detected.pointMembership ?? [] },
})
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      frame: native.source,
      reviewed,
      detected,
      binding,
      caveat:
        'Reviewed caption provenance is not independent room/floor detection; no metric geometry is accepted.',
    },
    null,
    2,
  ),
)
const ids = new Set(reviewed.markers.map((marker) => marker.labelId))
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
  <image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
  ${native.labels
    .filter((label) => ids.has(label.id))
    .map(({ point }) => `<circle cx="${point.x}" cy="${point.y}" r="7" fill="#cc0044"/>`)
    .join('')}
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(resolve(directory, 'reviewed-markers.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      verifiedCaptionLinks: binding.evidence.length,
      regionAssignments: binding.assignments.length,
      unresolvedSourceNumbers: binding.unresolvedSourceNumbers,
      ambiguousRegions: binding.ambiguities.length,
      overlappingCaptionIds: binding.overlappingLabelIds,
    },
    null,
    2,
  ),
)
