// Explicit paid experiment. No production reading, DB writes or metric conversion.
// bun --env-file=.env run apps/web/scripts/bench-anchored-plan.ts SOURCE_IMAGE FRESH_OUTPUT
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { PLAN_READER_ENDPOINT, PLAN_READER_MODEL } from '../../../packages/ai/src/floor-plan'
import {
  ANCHORED_SOURCE_PLAN_PROMPT,
  readAnchoredSourceTopology,
} from '../../../packages/ai/src/floor-plan-source-anchors'
import { rasterPlanCandidates } from '../lib/projects/plan-raster-candidates'

const [sourcePath, outputPath] = process.argv.slice(2)
if (!sourcePath || !outputPath) throw new Error('Supply source and fresh output directory')
const apiKey = process.env.FAL_KEY
if (!apiKey) throw new Error('FAL_KEY unavailable')
const body = await readFile(resolve(sourcePath))
const candidates = await rasterPlanCandidates(body, false, 1)
if (candidates.truncated || candidates.uncertain)
  throw new Error('Source candidates are incomplete')
const anchors: { id: string; x: number; y: number }[] = []
const ids = new Map<string, string>()
function anchor(point: { x: number; y: number }) {
  const key = `${point.x}:${point.y}`
  const existing = ids.get(key)
  if (existing) return existing
  const id = `p${anchors.length + 1}`
  anchors.push({ id, ...point })
  ids.set(key, id)
  return id
}
for (const point of candidates.points) anchor(point)
const segments = candidates.segments.map((segment) => {
  anchor({ x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 })
  return { startId: anchor(segment.start), endId: anchor(segment.end) }
})
if (anchors.length > 500)
  throw new Error('Too many source anchors; refusing an incomplete paid prompt')
const source = { width: candidates.width, height: candidates.height, anchors, segments }
const png = await sharp(body).png().toBuffer()
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}"><image width="${source.width}" height="${source.height}" href="data:image/png;base64,${png.toString('base64')}"/>${anchors.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="#c00040"/><text x="${point.x + 3}" y="${point.y - 3}" font-size="10" fill="#9a0033">${point.id}</text>`).join('')}</svg>`
const overlay = await sharp(Buffer.from(svg)).png().toBuffer()
const directory = resolve(outputPath)
await mkdir(dirname(directory), { recursive: true })
await mkdir(directory)
await writeFile(resolve(directory, 'anchors.json'), JSON.stringify(source, null, 2))
await writeFile(resolve(directory, 'anchor-overlay.png'), overlay)
const manifest = {
  model: PLAN_READER_MODEL,
  endpoint: PLAN_READER_ENDPOINT,
  promptSha256: createHash('sha256').update(ANCHORED_SOURCE_PLAN_PROMPT).digest('hex'),
  anchorsSha256: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
  sourceSha256: createHash('sha256').update(body).digest('hex'),
  overlaySha256: createHash('sha256').update(overlay).digest('hex'),
  anchors: anchors.length,
  requests: 1,
  status: 'started',
}
await writeFile(resolve(directory, 'request.json'), JSON.stringify(manifest))
try {
  const topology = await readAnchoredSourceTopology(
    apiKey,
    { body: png, contentType: 'image/png' },
    source,
    { body: overlay, contentType: 'image/png' },
    async (output) => {
      await writeFile(resolve(directory, 'response.txt'), output)
    },
  )
  await writeFile(resolve(directory, 'topology.json'), JSON.stringify(topology, null, 2))
  await writeFile(
    resolve(directory, 'request.json'),
    JSON.stringify({ ...manifest, status: 'parsed' }),
  )
  console.log(
    JSON.stringify({
      rooms: topology.rooms.length,
      openings: topology.openings.length,
      uncertainties: topology.uncertainties,
      status: 'draft',
      productionChanged: false,
    }),
  )
} catch (error) {
  await writeFile(
    resolve(directory, 'request.json'),
    JSON.stringify({ ...manifest, status: 'failed' }),
  )
  throw error
}
