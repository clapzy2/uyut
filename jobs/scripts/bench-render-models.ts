/**
 * Paid, reproducible renderer comparison on synthetic room briefs.
 * One image per model and case, no retries, no uploads and no customer data.
 * Completed files are cached locally so an interrupted run never pays for them twice.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  buildTemplatePlan,
  type ConceptModelId,
  conceptModels,
  createFalRenderer,
  reviewConceptImage,
  roomRenderAspectRatio,
  styleLibrary,
} from '@uyut/ai'
import sharp from 'sharp'
import { qualityBenchCases } from './quality-bench-cases'

const ALL_MODELS = [
  'nano-banana-2',
  'nano-banana-pro',
  'gpt-image-2.5',
  'gpt-image-2.5-sunburst',
  'kontext-pro',
] as const satisfies readonly ConceptModelId[]
const MAX_IMAGES = 45
const directory = resolve(process.env.MODEL_BENCH_DIR ?? 'output/model-bench-v1')
const apiKey = process.env.FAL_KEY
if (!apiKey) throw new Error('FAL_KEY required')
if (!process.argv.includes('--generate'))
  throw new Error('Pass --generate to authorize paid renders')
const requestedModels = process.env.MODEL_BENCH_MODELS?.split(',').filter(Boolean)
const models: ConceptModelId[] = requestedModels?.length
  ? requestedModels.map((model) => {
      if (!ALL_MODELS.includes(model as (typeof ALL_MODELS)[number])) {
        throw new Error(`Unknown benchmark model: ${model}`)
      }
      return model as ConceptModelId
    })
  : [...ALL_MODELS]
const requestedCases = new Set(process.env.MODEL_BENCH_CASES?.split(',').filter(Boolean) ?? [])
const cases = requestedCases.size
  ? qualityBenchCases.filter((testCase) => requestedCases.has(testCase.id))
  : qualityBenchCases
if (requestedCases.size && cases.length !== requestedCases.size)
  throw new Error('Unknown benchmark case')
if (models.length * cases.length > MAX_IMAGES) throw new Error('Paid image cap exceeded')

await mkdir(directory, { recursive: true })
const style = styleLibrary[1]
if (!style) throw new Error('Missing benchmark style')

type BenchResult = {
  caseId: string
  model: ConceptModelId
  status: 'ready' | 'failed'
  estimatedUsd: number
  reviewStatus?: string
  issues?: string[]
  error?: string
}

const results: BenchResult[] = []

for (const testCase of cases) {
  const brief = {
    roomKind: testCase.kind,
    roomName: testCase.id,
    areaM2: (testCase.width * testCase.depth) / 10000,
    condition: 'bare' as const,
    notes: testCase.notes,
    hasPhoto: false,
    sizeCm: { widthCm: testCase.width, depthCm: testCase.depth, ceilingCm: 270 },
    layoutNotes: testCase.layoutNotes,
    budgetKopecks: 80_000_000,
    household: testCase.household,
    primaryStyle: style,
    secondaryStyles: [],
    families: [style.family],
  }
  const plan = buildTemplatePlan(brief, 1)
  const prompt = `${plan.shared} ${plan.variations[0]} ${plan.mandate}`.replace(/\s+/g, ' ').trim()
  await writeFile(
    join(directory, `${testCase.id}-brief.json`),
    JSON.stringify({ brief, prompt }, null, 2),
  )

  for (const model of models) {
    const stem = `${testCase.id}--${model}`
    const imagePath = join(directory, `${stem}.webp`)
    const resultPath = join(directory, `${stem}.json`)
    const cached = await readFile(resultPath, 'utf8')
      .then((raw) => JSON.parse(raw) as BenchResult)
      .catch(() => null)
    if (cached) {
      results.push(cached)
      console.log(JSON.stringify({ ...cached, cached: true }))
      continue
    }

    console.log(JSON.stringify({ caseId: testCase.id, model, stage: 'render' }))
    try {
      const rendered = await createFalRenderer(apiKey, model).render({
        prompt,
        aspectRatio: roomRenderAspectRatio(brief),
      })
      const image = await sharp(rendered.body).webp({ quality: 90 }).toBuffer()
      await writeFile(imagePath, image)
      const reviewImage = await sharp(image)
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
      const review = await reviewConceptImage(
        apiKey,
        { body: reviewImage, contentType: 'image/jpeg' },
        brief,
      )
      const result: BenchResult = {
        caseId: testCase.id,
        model,
        status: 'ready',
        estimatedUsd: conceptModels[model].usdPerImage,
        reviewStatus: review.status,
        issues: review.issues.map((issue) => issue.code),
      }
      await writeFile(resultPath, JSON.stringify({ ...result, review }, null, 2))
      results.push(result)
      console.log(JSON.stringify(result))
    } catch (error) {
      const result: BenchResult = {
        caseId: testCase.id,
        model,
        status: 'failed',
        estimatedUsd: 0,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      }
      await writeFile(resultPath, JSON.stringify(result, null, 2))
      results.push(result)
      console.error(JSON.stringify(result))
    }
  }
}

const byModel = models.map((model) => {
  const rows = results.filter((result) => result.model === model)
  return {
    model,
    ready: rows.filter((result) => result.status === 'ready').length,
    failed: rows.filter((result) => result.status === 'failed').length,
    checked: rows.filter((result) => result.reviewStatus === 'checked').length,
    review: rows.filter((result) => result.reviewStatus === 'review').length,
    unavailable: rows.filter((result) => result.reviewStatus === 'unavailable').length,
    issueCount: rows.reduce((total, result) => total + (result.issues?.length ?? 0), 0),
    estimatedUsd: Number(rows.reduce((total, result) => total + result.estimatedUsd, 0).toFixed(2)),
  }
})
const summary = {
  createdAt: new Date().toISOString(),
  cases: cases.length,
  maxImages: MAX_IMAGES,
  imagesReady: results.filter((result) => result.status === 'ready').length,
  estimatedUsd: Number(
    results.reduce((total, result) => total + result.estimatedUsd, 0).toFixed(2),
  ),
  byModel,
}
await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2))

const TILE_WIDTH = 300
const TILE_HEIGHT = 220
const tiles: Array<{ input: Buffer; left: number; top: number }> = []
for (const [row, testCase] of cases.entries()) {
  for (const [column, model] of models.entries()) {
    const image = await readFile(join(directory, `${testCase.id}--${model}.webp`))
    const label = `${testCase.id} · ${conceptModels[model].label}`
    const overlay = Buffer.from(
      `<svg width="${TILE_WIDTH}" height="${TILE_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="30" fill="rgba(20,15,15,.82)"/><text x="9" y="20" fill="#fff" font-family="Arial,sans-serif" font-size="12">${label}</text></svg>`,
    )
    const tile = await sharp(image)
      .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'cover' })
      .composite([{ input: overlay, left: 0, top: 0 }])
      .webp({ quality: 84 })
      .toBuffer()
    tiles.push({ input: tile, left: column * TILE_WIDTH, top: row * TILE_HEIGHT })
  }
}
await sharp({
  create: {
    width: models.length * TILE_WIDTH,
    height: cases.length * TILE_HEIGHT,
    channels: 3,
    background: '#171112',
  },
})
  .composite(tiles)
  .webp({ quality: 86 })
  .toFile(join(directory, 'contact-sheet.webp'))
console.log(JSON.stringify(summary))
