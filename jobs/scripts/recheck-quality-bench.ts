/** Re-review local synthetic QA images only: no renders, uploads or database writes. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { reviewConceptImage } from '@uyut/ai'
import sharp from 'sharp'
import { qualityBenchCases } from './quality-bench-cases'

const key = process.env.FAL_KEY
if (!key) throw new Error('FAL_KEY required')
const directory = resolve(process.env.QUALITY_BENCH_DIR ?? 'output/quality-bench')
const results = join(directory, 'requirements-review')
await mkdir(results, { recursive: true })
const samples = qualityBenchCases.map((sample) => ({ ...sample, imageId: sample.id }))
if (process.argv.includes('--controls')) {
  const source = samples.find((sample) => sample.id === 'two-window-living')
  if (!source) throw new Error('Missing control source')
  samples.push(
    {
      ...source,
      id: 'control-no-armchair',
      notes: 'В комнате не должно быть кресел. Только диван.',
    },
    {
      ...source,
      id: 'control-no-windows',
      layoutNotes: 'В комнате нет окон и стеклянных дверей.',
      notes: '',
    },
  )
}
for (const sample of samples) {
  const path = join(results, `${sample.id}.json`)
  if (
    await readFile(path).then(
      () => true,
      () => false,
    )
  ) {
    console.log(JSON.stringify({ id: sample.id, cached: true }))
    continue
  }
  const body = await sharp(await readFile(join(directory, `${sample.imageId}.webp`)))
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  const review = await reviewConceptImage(
    key,
    { body, contentType: 'image/jpeg' },
    {
      roomKind: sample.kind,
      layoutNotes: sample.layoutNotes,
      notes: sample.notes,
    },
  )
  await writeFile(path, JSON.stringify(review, null, 2))
  console.log(JSON.stringify({ id: sample.id, status: review.status, issues: review.issues }))
}
