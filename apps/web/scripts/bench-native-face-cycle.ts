// Explicit source-face review, not automatic wall classification or metric acceptance.
// bun --no-env-file run apps/web/scripts/bench-native-face-cycle.ts PDF DIMENSION_REVIEW FACE_REVIEW FRESH_DIR EXPECTED_ROOM_FIXTURE
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  nativeDimensionEvidence,
  type ReviewedNativeDimensions,
} from '../lib/projects/plan-native-dimension-evidence'
import { nativeFaceCycle, type ReviewedNativeFaces } from '../lib/projects/plan-native-face-cycle'

const [pdfPath, dimensionPath, facePath, outputPath, expectedPath] = process.argv.slice(2)
if (!pdfPath || !dimensionPath || !facePath || !outputPath || !expectedPath)
  throw new Error('Supply PDF, both reviews, fresh directory and independent expected room fixture')
const dimensionsReview: ReviewedNativeDimensions = JSON.parse(
  await readFile(resolve(dimensionPath), 'utf8'),
)
const reviewed: ReviewedNativeFaces = JSON.parse(await readFile(resolve(facePath), 'utf8'))
const page = await preparePlanPage(
  await readFile(resolve(pdfPath)),
  true,
  reviewed.source.pdfPage,
  true,
  true,
)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Missing native page evidence')
const dimensions = nativeDimensionEvidence({
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
  reviewed: dimensionsReview,
})
const input = {
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
  dimensions,
  reviewed,
}
const cycle = nativeFaceCycle(input)
if (cycle.status !== 'candidate') throw new Error(cycle.reason)
assert.equal(cycle.status, 'candidate')
const expected = JSON.parse(await readFile(resolve(expectedPath), 'utf8'))
assert.deepEqual(expected.source, cycle.source)
assert.deepEqual(cycle.polygon, expected.room.polygon)
const missingFace = nativeFaceCycle({
  ...input,
  reviewed: { ...reviewed, faces: reviewed.faces.slice(1) },
})
assert.equal(missingFace.status, 'unresolved')
const operation = dimensions.dimensionOperations[0]
if (operation === undefined) throw new Error('Missing negative-control dimension operation')
const substituted = nativeFaceCycle({
  ...input,
  reviewed: {
    ...reviewed,
    faces: [
      { ref: { operationIndex: operation, subpathIndex: 0, segmentIndex: 0 }, kind: 'wall-face' },
      ...reviewed.faces.slice(1),
    ],
  },
})
assert.equal(substituted.status, 'unresolved')
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    { aiRequests: 0, reviewed, cycle, independentFixtureMatched: true, missingFace, substituted },
    null,
    2,
  ),
)
const scale = page.nativeTextAnchors.pageNormalizedScale
if (!scale) throw new Error('Missing native page/raster conversion')
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
  <image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
  <polygon points="${cycle.polygon.map((point) => `${point.x * scale.x},${point.y * scale.y}`).join(' ')}" fill="#008888" fill-opacity="0.08" stroke="#008888" stroke-width="3"/>
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(resolve(directory, 'native-cycle.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      status: cycle.status,
      vertexCount: cycle.polygon.length,
      independentFixtureMatched: true,
      missingFace: missingFace.status,
      substitutedDimension: substituted.status,
    },
    null,
    2,
  ),
)
