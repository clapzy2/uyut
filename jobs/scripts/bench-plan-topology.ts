// Explicitly paid, experimental source tracing. No DB writes or production reader changes.
// bun --env-file=.env run jobs/scripts/bench-plan-topology.ts SOURCE.png OUTPUT_DIRECTORY
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { PLAN_READER_ENDPOINT, PLAN_READER_MODEL } from '../../packages/ai/src/floor-plan'
import {
  readSourcePlanTopology,
  SOURCE_PLAN_PROMPT,
  type SourcePlanPoint,
  type SourcePlanTopology,
} from '../../packages/ai/src/floor-plan-source'

const [sourcePath, outputPath] = process.argv.slice(2)
if (!sourcePath || !outputPath) throw new Error('Supply source image and a fresh output directory')
const outputDirectory = resolve(outputPath)
const apiKey = process.env.FAL_KEY
if (!apiKey) throw new Error('FAL_KEY is not configured')
const sourceImage = await readFile(resolve(sourcePath))
const image = await sharp(sourceImage)
  .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 88 })
  .toBuffer({ resolveWithObject: true })
const useGrid = process.argv.includes('--grid')
const model = process.argv.includes('--gemini') ? 'google/gemini-2.5-pro' : PLAN_READER_MODEL
const gridLines = Array.from({ length: 11 }, (_, index) => {
  const x = (index * image.info.width) / 10
  const y = (index * image.info.height) / 10
  return `<line x1="${x}" y1="0" x2="${x}" y2="${image.info.height}" stroke="#8050d0" stroke-opacity="0.3"/>
<line x1="0" y1="${y}" x2="${image.info.width}" y2="${y}" stroke="#8050d0" stroke-opacity="0.3"/>
<text x="${Math.min(x + 2, image.info.width - 38)}" y="14" font-size="13" fill="#502090">${index * 100}</text>
<text x="2" y="${Math.max(28, Math.min(y - 2, image.info.height - 2))}" font-size="13" fill="#502090">${index * 100}</text>`
}).join('')
const grid = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.info.width}" height="${image.info.height}">${gridLines}</svg>`
const readingImage = useGrid
  ? await sharp(image.data)
      .composite([{ input: Buffer.from(grid) }])
      .png()
      .toBuffer()
  : image.data
await mkdir(dirname(outputDirectory), { recursive: true })
// Atomic claim: concurrent/repeated invocations cannot submit another paid request here.
await mkdir(outputDirectory)
// Leave the marker after failure too: a retry must be an explicit new experiment.
const request = {
  requests: 1,
  status: 'started',
  grid: useGrid,
  model,
  endpoint: PLAN_READER_ENDPOINT,
  sourceSha256: createHash('sha256').update(sourceImage).digest('hex'),
  inputSha256: createHash('sha256').update(readingImage).digest('hex'),
  promptSha256: createHash('sha256').update(SOURCE_PLAN_PROMPT).digest('hex'),
  width: image.info.width,
  height: image.info.height,
}
const requestFile = resolve(outputDirectory, 'request.json')
await writeFile(requestFile, JSON.stringify(request))
await writeFile(
  resolve(outputDirectory, useGrid ? 'reader-input.png' : 'reader-input.jpg'),
  readingImage,
)
let topology: SourcePlanTopology
try {
  topology = await readSourcePlanTopology(
    apiKey,
    { body: readingImage, contentType: useGrid ? 'image/png' : 'image/jpeg' },
    async (output) => {
      await writeFile(resolve(outputDirectory, 'response.txt'), output)
    },
    model,
  )
  await writeFile(requestFile, JSON.stringify({ ...request, status: 'response-parsed' }))
} catch (error) {
  await writeFile(requestFile, JSON.stringify({ ...request, status: 'failed' }))
  throw error
}
await writeFile(resolve(outputDirectory, 'topology.json'), JSON.stringify(topology, null, 2))

function pixel(point: SourcePlanPoint) {
  return { x: (point.x * image.info.width) / 1000, y: (point.y * image.info.height) / 1000 }
}

function ring(points: SourcePlanPoint[] | null, color: string) {
  if (!points) return ''
  const coordinates = points
    .map((point) => {
      const converted = pixel(point)
      return `${converted.x},${converted.y}`
    })
    .join(' ')
  return `<polygon points="${coordinates}" fill="none" stroke="${color}" stroke-width="3"/>`
}

const segments = topology.openings
  .map((opening, index) => {
    const start = pixel(opening.start)
    const end = pixel(opening.end)
    const color =
      opening.type === 'window' ? '#005ad6' : opening.type === 'balcony' ? '#d40093' : '#d65a00'
    return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${color}" stroke-width="7"/><text x="${start.x + 4}" y="${start.y - 5}" font-size="16" fill="${color}">${index + 1}</text>`
  })
  .join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.info.width}" height="${image.info.height}">
<image width="${image.info.width}" height="${image.info.height}" href="data:image/jpeg;base64,${image.data.toString('base64')}"/>
${ring(topology.footprint, '#de002d')}
${topology.rooms.map((room) => ring(room.polygon, '#008844')).join('')}
${segments}
</svg>`
await writeFile(resolve(outputDirectory, 'overlay.svg'), svg)
await sharp(Buffer.from(svg)).png().toFile(resolve(outputDirectory, 'overlay.png'))
console.log(
  JSON.stringify({
    status: 'draft',
    requests: 1,
    rooms: topology.rooms.length,
    openings: topology.openings.length,
    uncertainties: topology.uncertainties,
    outputDirectory,
    metricGeometryChanged: false,
  }),
)
