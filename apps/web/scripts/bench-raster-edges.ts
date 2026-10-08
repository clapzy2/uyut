// Explicit offline pixel check. No AI, database, storage upload or inferred room geometry.
// bun run apps/web/scripts/bench-raster-edges.ts SOURCE_IMAGE OUTPUT_DIRECTORY
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { rasterPlanCandidates } from '../lib/projects/plan-raster-candidates'

const [sourcePath, outputPath] = process.argv.slice(2)
if (!sourcePath || !outputPath) throw new Error('Supply a source image and output directory')
const source = await readFile(resolve(sourcePath))
const directory = resolve(outputPath)
await mkdir(directory, { recursive: true })
const variants = [
  { name: 'original', body: source },
  { name: 'jpeg-60', body: await sharp(source).jpeg({ quality: 60 }).toBuffer() },
  { name: 'rotated-90', body: await sharp(source).rotate(90).png().toBuffer() },
  { name: 'mirrored', body: await sharp(source).flop().png().toBuffer() },
]
const fixture = process.argv.includes('--balcony-fixture')
function diagonalCoverage(
  variant: string,
  candidates: Awaited<ReturnType<typeof rasterPlanCandidates>>,
) {
  const transform = ({ x, y }: { x: number; y: number }) =>
    variant === 'rotated-90'
      ? { x: 970 - y, y: x }
      : variant === 'mirrored'
        ? { x: 820 - x, y }
        : { x, y }
  const first = transform({ x: 710, y: 810 }),
    last = transform({ x: 660, y: 860 })
  const dx = last.x - first.x,
    dy = last.y - first.y,
    length = Math.hypot(dx, dy)
  const position = (point: { x: number; y: number }) =>
    ((point.x - first.x) * dx + (point.y - first.y) * dy) / (length * length)
  const error = (point: { x: number; y: number }) =>
    Math.abs((point.x - first.x) * dy - (point.y - first.y) * dx) / length
  return candidates.segments.some((segment) => {
    const from = position(segment.start),
      to = position(segment.end)
    return (
      Math.max(error(segment.start), error(segment.end)) <= 2 &&
      Math.min(from, to) >= -0.05 &&
      Math.max(from, to) <= 1.05 &&
      Math.abs(from - to) >= 0.7
    )
  })
}
const results = []
for (const variant of variants) {
  const started = performance.now()
  const candidates = await rasterPlanCandidates(variant.body, false, 1)
  const elapsedMs = Math.round(performance.now() - started)
  await writeFile(resolve(directory, `${variant.name}.json`), JSON.stringify(candidates, null, 2))
  const image = await sharp(variant.body).png().toBuffer()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${candidates.width}" height="${candidates.height}"><image width="${candidates.width}" height="${candidates.height}" href="data:image/png;base64,${image.toString('base64')}"/>${candidates.segments.map((segment) => `<line x1="${segment.start.x}" y1="${segment.start.y}" x2="${segment.end.x}" y2="${segment.end.y}" stroke="#008899" stroke-width="1.5"/>`).join('')}${candidates.points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" fill="#cc2244"/>`).join('')}</svg>`
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(directory, `${variant.name}.png`))
  results.push({
    variant: variant.name,
    width: candidates.width,
    height: candidates.height,
    segments: candidates.segments.length,
    points: candidates.points.length,
    truncated: candidates.truncated,
    uncertain: candidates.uncertain,
    elapsedMs,
    ...(fixture ? { diagonalSupported: diagonalCoverage(variant.name, candidates) } : {}),
  })
}
await writeFile(
  resolve(directory, 'results.json'),
  JSON.stringify({ aiRequests: 0, results }, null, 2),
)
console.log(JSON.stringify({ aiRequests: 0, results }))
if (fixture && results.some((result) => 'diagonalSupported' in result && !result.diagonalSupported))
  throw new Error('Fixture diagonal evidence did not pass')
