/** One paid regression render, local only. No uploads, database writes or automatic retry. */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  architectureAnchoredPrompt,
  buildTemplatePlan,
  type ConceptBrief,
  createFalRenderer,
  reviewConceptImage,
} from '@uyut/ai'
import sharp from 'sharp'

const key = process.env.FAL_KEY
if (!key) throw new Error('FAL_KEY required')
const directory = resolve(process.env.QUALITY_BENCH_DIR ?? 'output/quality-bench')
const id = process.env.ANCHOR_BENCH_CASE ?? 'two-window-living'
if (!/^[a-z0-9-]{1,70}$/.test(id)) throw new Error('Invalid case id')
const resultPath = join(directory, `${id}-anchored.webp`)
const reportPath = join(directory, `${id}-anchored.json`)
if (
  await readFile(reportPath).then(
    () => true,
    () => false,
  )
) {
  console.log(JSON.stringify({ id, cached: true }))
  process.exit(0)
}

const saved = JSON.parse(await readFile(join(directory, `${id}-brief.json`), 'utf8')) as {
  brief: ConceptBrief
}
const plan = buildTemplatePlan(saved.brief, 2)
const prompt = architectureAnchoredPrompt(
  `${plan.shared} ${plan.variations[1]} ${plan.mandate}`.replace(/\s+/g, ' ').trim(),
)
const anchor = await readFile(join(directory, `${id}.webp`))
const rendered = await createFalRenderer(key, 'nano-banana-2').render({
  prompt,
  imageUrl: `data:image/webp;base64,${anchor.toString('base64')}`,
  aspectRatio: '16:9',
})
const output = await sharp(rendered.body).webp({ quality: 88 }).toBuffer()
await writeFile(resultPath, output)
const reviewBody = await sharp(output)
  .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()
const review = await reviewConceptImage(
  key,
  { body: reviewBody, contentType: 'image/jpeg' },
  saved.brief,
)
await writeFile(reportPath, JSON.stringify({ id, source: `${id}.webp`, prompt, review }, null, 2))
console.log(
  JSON.stringify({ id, status: review.status, issues: review.issues.map((issue) => issue.code) }),
)
