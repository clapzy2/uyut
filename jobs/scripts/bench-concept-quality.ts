/**
 * Standalone QA, no database writes or uploads. --generate allows exactly six renders.
 * Existing HTTPS URLs or WebP data URLs arrive on stdin and never enter the report.
 * Cached images/results prevent repeated charges when continuing an interrupted run.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  type ConceptBrief,
  createFalRenderer,
  createPromptBuilder,
  reviewConceptImage,
  styleLibrary,
} from '@uyut/ai'
import sharp from 'sharp'
import { qualityBenchCases } from './quality-bench-cases'

const directory = resolve(process.env.QUALITY_BENCH_DIR ?? 'output/quality-bench')
function requireApiKey(): string {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY required')
  return key
}
const apiKey = requireApiKey()
await mkdir(directory, { recursive: true })
type Sample = {
  id: string
  kind: ConceptBrief['roomKind']
  url?: string
  layoutNotes?: string
  brief?: ConceptBrief
}
const samples: Sample[] = []
if (process.argv.includes('--stdin')) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > 40_000_000) throw new Error('Input too large')
    chunks.push(bytes)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!Array.isArray(input) || input.length > 20) throw new Error('Expected at most 20 samples')
  for (const item of input) {
    if (
      !/^[a-z0-9-]{1,70}$/.test(item.id) ||
      !['living', 'kitchen', 'bedroom'].includes(item.kind) ||
      typeof item.url !== 'string' ||
      !(
        new URL(item.url).protocol === 'https:' ||
        /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(item.url)
      )
    )
      throw new Error('Invalid sample')
    samples.push({ id: item.id, kind: item.kind, url: item.url, layoutNotes: item.layoutNotes })
  }
}
if (process.argv.includes('--generate')) {
  const style = styleLibrary[1]
  if (!style) throw new Error('Missing style')
  for (const item of qualityBenchCases) {
    samples.push({
      id: item.id,
      kind: item.kind,
      layoutNotes: item.layoutNotes,
      brief: {
        roomKind: item.kind,
        roomName: item.id,
        areaM2: (item.width * item.depth) / 10000,
        condition: 'bare',
        notes: item.notes,
        hasPhoto: false,
        sizeCm: { widthCm: item.width, depthCm: item.depth, ceilingCm: 270 },
        layoutNotes: item.layoutNotes,
        budgetKopecks: 80000000,
        household: null,
        primaryStyle: style,
        secondaryStyles: [],
        families: [style.family],
      },
    })
  }
}
if (!samples.length) throw new Error('Use --generate and/or --stdin')
const engine = createFalRenderer(apiKey, 'nano-banana-2')
const builder = createPromptBuilder({ falKey: apiKey })

async function run(sample: Sample) {
  const imagePath = join(directory, `${sample.id}.webp`)
  const resultPath = join(directory, `${sample.id}.json`)
  if (
    await readFile(resultPath).then(
      () => true,
      () => false,
    )
  ) {
    console.log(JSON.stringify({ id: sample.id, status: 'cached' }))
    return
  }
  let body: Buffer | null = await readFile(imagePath).catch(() => null)
  if (!body) {
    if (sample.brief) {
      const plan = await builder.build(sample.brief, 1)
      const prompt = `${plan.shared} ${plan.variations[0]} ${plan.mandate}`.trim()
      await writeFile(
        join(directory, `${sample.id}-brief.json`),
        JSON.stringify({ brief: sample.brief, prompt, source: plan.source }, null, 2),
      )
      console.log(JSON.stringify({ id: sample.id, stage: 'render', promptSource: plan.source }))
      body = (await engine.render({ prompt, aspectRatio: '16:9' })).body
    } else if (sample.url) {
      const response = await fetch(sample.url, { signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`Sample request failed: ${response.status}`)
      body = Buffer.from(await response.arrayBuffer())
    }
    if (!body || body.length > 20000000) throw new Error('Missing or oversized image')
    body = await sharp(body).webp({ quality: 88 }).toBuffer()
    await writeFile(imagePath, body)
  }
  const image = {
    body: await sharp(body)
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer(),
    contentType: 'image/jpeg',
  }
  const review = await reviewConceptImage(apiKey, image, {
    roomKind: sample.kind,
    layoutNotes: sample.layoutNotes,
  })
  // Wrong-kind controls are separate requests, never counted as additional images.
  const controlKind = sample.kind === 'kitchen' ? 'bedroom' : 'kitchen'
  const control = await reviewConceptImage(apiKey, image, { roomKind: controlKind })
  const result = {
    id: sample.id,
    kind: sample.kind,
    source: sample.brief ? 'synthetic-generation' : 'existing-concept',
    layoutNotes: sample.layoutNotes ?? null,
    review,
    control: { expectedKind: controlKind, review: control },
  }
  await writeFile(resultPath, JSON.stringify(result, null, 2))
  console.log(
    JSON.stringify({
      id: sample.id,
      status: review.status,
      issues: review.issues.map((i) => i.code),
      control: control.status,
      controlIssues: control.issues.map((i) => i.code),
    }),
  )
}

let failures = 0
// Two concurrent samples cap the load on the image and review providers.
for (let index = 0; index < samples.length; index += 2) {
  await Promise.all(
    samples.slice(index, index + 2).map((sample) =>
      run(sample).catch((error) => {
        failures++
        console.error(
          JSON.stringify({ id: sample.id, error: error instanceof Error ? error.name : 'Error' }),
        )
      }),
    ),
  )
}
if (failures) process.exitCode = 1
