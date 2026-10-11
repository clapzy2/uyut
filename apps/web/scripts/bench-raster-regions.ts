// Offline free-area candidates. No AI, names, metric dimensions or writes to a project.
// bun run apps/web/scripts/bench-raster-regions.ts SOURCE_IMAGE OUTPUT_DIRECTORY
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { detectPlanRasterRegions } from '../lib/projects/plan-raster-regions'

const [sourcePath, outputPath] = process.argv.slice(2)
if (!sourcePath || !outputPath) throw new Error('Supply source and output directory')
const body = await readFile(resolve(sourcePath))
const directory = resolve(outputPath)
await mkdir(directory, { recursive: true })
const metadata = await sharp(body).metadata()
if (!metadata.width || !metadata.height) throw new Error('Missing dimensions')
const variants = [
  { name: 'original', body },
  { name: 'jpeg-60', body: await sharp(body).jpeg({ quality: 60 }).toBuffer() },
  { name: 'rotated-90', body: await sharp(body).rotate(90).png().toBuffer() },
  {
    name: 'cropped',
    body: await sharp(body)
      .extract({
        left: 0,
        top: 0,
        width: Math.floor(metadata.width * 0.7),
        height: Math.floor(metadata.height * 0.8),
      })
      .png()
      .toBuffer(),
  },
]
const summaries = []
for (const variant of variants) {
  const variantSize = await sharp(variant.body).metadata()
  if (!variantSize.width || !variantSize.height) throw new Error('Missing variant frame')
  const image = await sharp(variant.body)
    .flatten({ background: 'white' })
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const started = performance.now()
  const result = detectPlanRasterRegions({
    grayscale: image.data,
    width: image.info.width,
    height: image.info.height,
  })
  const elapsedMs = Math.round(performance.now() - started)
  await writeFile(
    resolve(directory, `${variant.name}.json`),
    JSON.stringify(
      {
        width: image.info.width,
        height: image.info.height,
        frame: {
          coordinateSpace: 'analysis-pixels',
          variant: variant.name,
          sourceWidth: variantSize.width,
          sourceHeight: variantSize.height,
          analysisWidth: image.info.width,
          analysisHeight: image.info.height,
          sourcePixelsPerAnalysisX: variantSize.width / image.info.width,
          sourcePixelsPerAnalysisY: variantSize.height / image.info.height,
          sourceSha256: createHash('sha256').update(variant.body).digest('hex'),
          originalSha256: createHash('sha256').update(body).digest('hex'),
        },
        ...result,
      },
      null,
      2,
    ),
  )
  const source = await sharp(variant.body)
    .resize({ width: image.info.width, height: image.info.height, fit: 'fill' })
    .png()
    .toBuffer()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.info.width}" height="${image.info.height}"><image width="${image.info.width}" height="${image.info.height}" href="data:image/png;base64,${source.toString('base64')}"/>${result.regions.map((region) => `<polygon points="${region.polygon.map((point) => `${point.x},${point.y}`).join(' ')}" fill="#008888" fill-opacity="0.1" stroke="#008888" stroke-width="2"/><text x="${region.polygon[0]?.x ?? 0}" y="${region.polygon[0]?.y ?? 0}" fill="#cc0044">${region.id}</text>`).join('')}</svg>`
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(directory, `${variant.name}.png`))
  summaries.push({
    variant: variant.name,
    regions: result.regions.length,
    truncated: result.truncated,
    uncertain: result.uncertain,
    elapsedMs,
    areas: result.regions.map((region) => ({
      id: region.id,
      pixelArea: region.pixelArea,
      vertices: region.polygon.length,
      interiorIslands: region.hasInteriorIslands,
    })),
  })
}
await writeFile(
  resolve(directory, 'results.json'),
  JSON.stringify({ aiRequests: 0, summaries }, null, 2),
)
console.log(JSON.stringify({ aiRequests: 0, summaries }))
