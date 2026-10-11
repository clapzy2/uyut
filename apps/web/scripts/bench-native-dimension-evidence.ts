// Offline reviewed labels only; no pixel removal, floor import or paid calls.
// bun --no-env-file run apps/web/scripts/bench-native-dimension-evidence.ts PDF REVIEW_JSON FRESH_DIR
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  nativeDimensionEvidence,
  type ReviewedNativeDimensions,
} from '../lib/projects/plan-native-dimension-evidence'
import { rasterDimensionBoundaryAudit } from '../lib/projects/plan-raster-dimension-boundaries'
import { detectPlanRasterRegions } from '../lib/projects/plan-raster-regions'

const [pdfPath, reviewPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !reviewPath || !outputPath)
  throw new Error('Supply PDF, dimension review JSON and fresh directory')
const reviewed: ReviewedNativeDimensions = JSON.parse(await readFile(resolve(reviewPath), 'utf8'))
const page = await preparePlanPage(
  await readFile(resolve(pdfPath)),
  true,
  reviewed.source.pdfPage,
  true,
  true,
)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Missing native layers')
const input = {
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
  reviewed,
}
const evidence = nativeDimensionEvidence(input)
const grayscale = await sharp(page.image.body).greyscale().raw().toBuffer()
const detected = detectPlanRasterRegions({
  grayscale,
  width: page.image.width,
  height: page.image.height,
})
if (detected.truncated) throw new Error('Truncated raster candidate inventory')
const boundaryAudit = rasterDimensionBoundaryAudit({
  native: page.nativeTextAnchors,
  dimensions: evidence,
  regions: detected.regions,
})
const firstCandidate = evidence.chains.find((chain) => chain.result.status === 'candidate')
const operation = firstCandidate?.rails[0]?.operationIndex
let conflictControlPassed = false
if (operation !== undefined) {
  const conflict = nativeDimensionEvidence({
    ...input,
    reviewed: {
      ...reviewed,
      wallOperations: [...new Set([...reviewed.wallOperations, operation])],
    },
  })
  const refused = conflict.chains.find((chain) => chain.id === firstCandidate?.id)
  assert.deepEqual(refused?.result, {
    status: 'unresolved',
    reason: 'dimension-wall-role-conflict',
  })
  conflictControlPassed = true
}
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    { aiRequests: 0, reviewed, evidence, detected, boundaryAudit, conflictControlPassed },
    null,
    2,
  ),
)
const scale = page.nativeTextAnchors.pageNormalizedScale
if (!scale) throw new Error('Missing page/raster conversion')
const rails = evidence.chains.flatMap((chain) => chain.rails).filter((rail) => rail !== null)
const blockedIds = new Set(
  boundaryAudit.audits
    .filter((audit) => audit.status === 'blocked-annotation-boundary')
    .map((audit) => audit.regionId),
)
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
  <image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
  ${detected.regions
    .filter((region) => blockedIds.has(region.id))
    .map(
      (region) =>
        `<polygon points="${region.polygon.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="#cc0044" fill-opacity="0.1" stroke="#cc0044" stroke-width="1"/>`,
    )
    .join('')}
  ${rails.map((rail) => `<polyline points="${rail.points.map((point) => `${point.x * scale.x},${point.y * scale.y}`).join(' ')}" fill="none" stroke="#d06000" stroke-width="3"/>`).join('')}
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(resolve(directory, 'dimension-rails.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      conflictControlPassed,
      blockedCandidateRegions: blockedIds.size,
      unverifiedCandidateRegions: boundaryAudit.audits.length - blockedIds.size,
      chains: evidence.chains.map((chain) => ({ id: chain.id, result: chain.result })),
    },
    null,
    2,
  ),
)
