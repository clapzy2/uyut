// Explicit paid naming experiment. Shapes stay owned by the pixel detector; no project writes.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { PLAN_READER_ENDPOINT, PLAN_READER_MODEL } from '../../../packages/ai/src/floor-plan'
import {
  REGION_NAMES_PROMPT,
  readRegionNames,
} from '../../../packages/ai/src/floor-plan-region-names'
import { detectPlanRasterRegions } from '../lib/projects/plan-raster-regions'

const [sourcePath, outputPath] = process.argv.slice(2)
if (!sourcePath || !outputPath) throw new Error('Supply source and fresh output')
if (!process.argv.includes('--balcony-fixture'))
  throw new Error('Expected names are defined only for the controlled balcony fixture')
const key = process.env.FAL_KEY
if (!key) throw new Error('FAL_KEY unavailable')
const original = await readFile(resolve(sourcePath))
const cropControl = process.argv.includes('--crop-control')
const body = cropControl
  ? await sharp(original).extract({ left: 0, top: 0, width: 574, height: 776 }).png().toBuffer()
  : original
const gray = await sharp(body)
  .flatten({ background: 'white' })
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true })
const detected = detectPlanRasterRegions({
  grayscale: gray.data,
  width: gray.info.width,
  height: gray.info.height,
})
if (detected.truncated) throw new Error('Incomplete candidates: no paid naming request')
const source = {
  width: gray.info.width,
  height: gray.info.height,
  regions: detected.regions.map(({ id, polygon }) => ({ id, polygon })),
  truncated: detected.truncated,
  expectedNames: ['Прихожая', 'Санузел', 'Кухня', 'Гостиная', 'Балкон'],
}
const png = await sharp(body).png().toBuffer()
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}"><image width="${source.width}" height="${source.height}" href="data:image/png;base64,${png.toString('base64')}"/>${source.regions.map((region) => `<polygon points="${region.polygon.map((point) => `${point.x},${point.y}`).join(' ')}" fill="#008888" fill-opacity="0.1" stroke="#008888" stroke-width="2"/><text x="${region.polygon[0]?.x ?? 0}" y="${region.polygon[0]?.y ?? 0}" fill="#cc0044" font-size="14">${region.id}</text>`).join('')}</svg>`
const overlay = await sharp(Buffer.from(svg)).png().toBuffer()
const directory = resolve(outputPath)
await mkdir(dirname(directory), { recursive: true })
await mkdir(directory)
const manifest = {
  model: PLAN_READER_MODEL,
  endpoint: PLAN_READER_ENDPOINT,
  promptSha256: createHash('sha256').update(REGION_NAMES_PROMPT).digest('hex'),
  overlaySha256: createHash('sha256').update(overlay).digest('hex'),
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  inputSha256: createHash('sha256').update(body).digest('hex'),
  cropControl,
  regionsSha256: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
  requests: 1,
  status: 'started',
}
await writeFile(resolve(directory, 'request.json'), JSON.stringify(manifest))
await writeFile(resolve(directory, 'source-regions.json'), JSON.stringify(source, null, 2))
await writeFile(resolve(directory, 'overlay.png'), overlay)
try {
  const result = await readRegionNames(
    key,
    { body: png, contentType: 'image/png' },
    source,
    { body: overlay, contentType: 'image/png' },
    async (output) => {
      await writeFile(resolve(directory, 'response.txt'), output)
    },
  )
  await writeFile(resolve(directory, 'names.json'), JSON.stringify(result, null, 2))
  await writeFile(
    resolve(directory, 'request.json'),
    JSON.stringify({ ...manifest, status: 'parsed' }),
  )
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(
    resolve(directory, 'request.json'),
    JSON.stringify({ ...manifest, status: 'failed' }),
  )
  throw error
}
