// Explicit same-source assignments only: no room guessing, page review save or metric approval.
// bun --no-env-file run apps/web/scripts/bench-native-page-contours.ts PDF FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PlanReading } from '@uyut/db'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  nativeDimensionEvidence,
  type ReviewedNativeDimensions,
} from '../lib/projects/plan-native-dimension-evidence'
import type { ReviewedNativeFaces } from '../lib/projects/plan-native-face-cycle'
import { nativePageContourCandidates } from '../lib/projects/plan-native-page-contours'
import { planPageContoursSchema } from '../lib/projects/plan-page-review'

const [pdfPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !outputPath) throw new Error('Supply original PDF and fresh output directory')
const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(resolve('docs/qa/fixtures', name), 'utf8'))
const bedroom = await fixture<ReviewedNativeFaces>('apartment-native-reviewed-bedroom-faces.json')
const balcony = await fixture<ReviewedNativeFaces>('apartment-native-reviewed-balcony-faces.json')
const dimensionReview = await fixture<ReviewedNativeDimensions>(
  'apartment-native-reviewed-dimensions.json',
)
type Expected = {
  sourceRoomNumbers: number[]
  room: { sourceNumber: number; polygon: { x: number; y: number }[] }
}
const bedroomExpected = await fixture<Expected>('chigintseva-existing-bedroom-02.json')
const balconyExpected = await fixture<Expected>('chigintseva-existing-balcony-08.json')
const body = await readFile(resolve(pdfPath))
assert.equal(createHash('sha256').update(body).digest('hex'), bedroom.source.sha256)
const page = await preparePlanPage(body, true, bedroom.source.pdfPage, true, true)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Native layers unavailable')
const dimensions = nativeDimensionEvidence({
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
  reviewed: dimensionReview,
})
const reading: Pick<PlanReading, 'rooms' | 'sourcePage' | 'planState'> = {
  sourcePage: bedroom.source.pdfPage,
  planState: 'existing',
  // Explicit archived source inventory, not a newly inferred numeric sequence or room kind.
  rooms: bedroomExpected.sourceRoomNumbers.map((sourceNumber) => ({
    sourceNumber,
    name: `Источник ${sourceNumber}`,
    kind: 'living',
  })),
}
const input = {
  source: bedroom.source,
  native: page.nativeTextAnchors,
  work: page.linework,
  lineworkSource: page.lineworkRasterSource,
  dimensions,
  reading,
  rooms: [
    { identity: { roomSourceNumber: bedroomExpected.room.sourceNumber }, reviewed: bedroom },
    { identity: { roomSourceNumber: balconyExpected.room.sourceNumber }, reviewed: balcony },
  ],
}
const before = structuredClone(input)
const result = nativePageContourCandidates(input)
assert.equal(result.status, 'partial', result.reason)
assert.ok(result.contours)
assert.deepEqual(
  result.contours.rooms.map((room) => room.polygon),
  [bedroomExpected.room.polygon, balconyExpected.room.polygon],
)
assert.deepEqual(result.missingSourceNumbers, [1, 3, 4, 5, 6, 7])
assert.equal(Object.hasOwn(result.contours, 'review'), false)
assert.equal(Object.hasOwn(result.contours, 'floor'), false)
assert.equal(planPageContoursSchema.safeParse(result.contours).success, false)
assert.deepEqual(result.readiness, { readOnly: true, readyFor2D: false, readyFor3D: false })
assert.deepEqual(input, before)
const firstRoom = input.rooms[0]
const secondRoom = input.rooms[1]
if (!firstRoom || !secondRoom) throw new Error('Missing explicit source assignments')
const missing = nativePageContourCandidates({
  ...input,
  rooms: [firstRoom, { ...secondRoom, reviewed: { ...balcony, faces: balcony.faces.slice(1) } }],
})
assert.equal(missing.status, 'unresolved')
assert.equal(missing.contours, null)
const output = resolve(outputPath)
await mkdir(output, { recursive: false })
await writeFile(join(output, 'candidates.json'), JSON.stringify(result, null, 2))
const scale = page.nativeTextAnchors.pageNormalizedScale
if (!scale) throw new Error('Missing source raster scale')
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.image.width}" height="${page.image.height}">
<image width="${page.image.width}" height="${page.image.height}" href="data:image/jpeg;base64,${page.image.body.toString('base64')}"/>
${result.contours.rooms.map((room) => `<polygon points="${room.polygon.map((point) => `${point.x * scale.x},${point.y * scale.y}`).join(' ')}" fill="#008888" fill-opacity="0.12" stroke="#008888" stroke-width="3"/>`).join('\n')}
</svg>`
await sharp(Buffer.from(overlay)).png().toFile(join(output, 'source-candidates.png'))
const summary = {
  source: result.contours.source,
  status: result.status,
  roomNumbers: result.contours.rooms.map((room) => room.roomSourceNumber),
  vertexCounts: result.contours.rooms.map((room) => room.polygon.length),
  roomContacts: result.roomContacts,
  missingSourceNumbers: result.missingSourceNumbers,
  issues: result.issues,
  incompleteCycle: missing.reason,
  aiRequests: 0,
  projectWrites: 0,
}
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
