/** Rechecks saved synthetic images. No rendering, database writes or automatic retries. */
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { reviewConceptImage } from '@uyut/ai'
import sharp from 'sharp'

const key = process.env.FAL_KEY
if (!key) throw new Error('FAL_KEY required')
const input = resolve('output/live-photo-20261106')
const source = resolve('output/layout-guide-production-20261106/render.png')
const destination = process.env.EQUIPMENT_REVIEW_OUTPUT
if (!destination) throw new Error('Set EQUIPMENT_REVIEW_OUTPUT to a new results directory')
const selected = process.env.EQUIPMENT_REVIEW_CASES?.split(',')
const notes =
  'Сохранить окно, дверь, перспективу и три основных предмета: диван слева, ТВ-тумба справа, журнальный столик перед диваном. Обновить интерьер в спокойном современном стиле: светлые стены, светлый дуб, зелёные акценты. Не добавлять шкафы, кресла или вторую тумбу.'
type Sample = {
  id: string
  variant: number
  expected: 'review' | 'checked' | 'visual-review'
  equipment?: string
  condition?: 'bare' | 'finished' | 'keep'
  notes?: string
  revision?: string
  requestedVariant?: string
  reference?: 'same' | 'cropped' | 'none'
}
const samples: Sample[] = [
  { id: 'variant-1', variant: 1, expected: 'visual-review' },
  { id: 'added-ac', variant: 2, expected: 'review', equipment: 'кондиционер' },
  { id: 'variant-3', variant: 3, expected: 'visual-review' },
  { id: 'added-radiator', variant: 4, expected: 'review', equipment: 'радиатор|батаре' },
  { id: 'variant-5', variant: 5, expected: 'visual-review' },
  {
    id: 'no-source-variant-permission',
    variant: 4,
    reference: 'none',
    expected: 'checked',
    notes: 'Не добавлять радиатор.',
    requestedVariant: 'Добавить белый радиатор под окном.',
  },
  {
    id: 'requested-variant-radiator',
    variant: 4,
    expected: 'checked',
    requestedVariant: 'Добавить радиатор под окном, остальное по прежним пожеланиям.',
  },
  {
    id: 'revision-cancels-addition',
    variant: 4,
    expected: 'review',
    equipment: 'радиатор|батаре',
    requestedVariant: 'Добавить радиатор под окном.',
    revision: 'Не добавлять радиатор, сохранить стену под окном свободной.',
  },
  {
    id: 'requested-radiator',
    variant: 4,
    expected: 'checked',
    revision: 'Добавить белый радиатор под окном. Остальное по прежним пожеланиям.',
  },
  {
    id: 'requested-ac',
    variant: 2,
    expected: 'checked',
    revision: 'Добавить кондиционер справа наверху. Остальное по прежним пожеланиям.',
  },
  {
    id: 'existing-radiator',
    variant: 4,
    reference: 'same',
    expected: 'checked',
    condition: 'keep',
    notes: 'Оставить комнату как есть.',
  },
  { id: 'no-source', variant: 4, reference: 'none', expected: 'checked' },
  { id: 'source-area-not-visible', variant: 4, reference: 'cropped', expected: 'checked' },
  {
    id: 'bare-equipment',
    variant: 4,
    condition: 'bare',
    expected: 'checked',
    notes: 'Спроектировать гостиную с новой отделкой и необходимым отоплением.',
  },
]
if (selected?.some((id) => !samples.some((sample) => sample.id === id))) {
  throw new Error('Unknown EQUIPMENT_REVIEW_CASES entry')
}
await mkdir(destination, { recursive: true })
let failures = 0
for (const sample of samples.filter((item) => !selected || selected.includes(item.id))) {
  const output = join(destination, `${sample.id}.json`)
  if (
    await access(output).then(
      () => true,
      () => false,
    )
  ) {
    throw new Error(`Result exists: ${output}; not charging twice`)
  }
  const imagePath = join(input, `concept-${sample.variant}.webp`)
  const image = {
    body: await sharp(await readFile(imagePath))
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer(),
    contentType: 'image/jpeg',
  }
  const referencePath = sample.reference === 'same' ? imagePath : source
  let reference: { body: Buffer; contentType: string } | undefined
  if (sample.reference !== 'none') {
    let pipeline = sharp(await readFile(referencePath))
    // Technical crop for the negative control: the window wall is outside the source frame.
    if (sample.reference === 'cropped')
      pipeline = pipeline.extract({ left: 0, top: 0, width: 440, height: 896 })
    reference = {
      body: await pipeline
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer(),
      contentType: 'image/jpeg',
    }
  }
  const brief = {
    roomKind: 'living' as const,
    condition: sample.condition ?? 'finished',
    notes: sample.notes ?? notes,
    revision: sample.revision ?? null,
    requestedVariant: sample.requestedVariant,
    layoutNotes:
      'Синтетическая QA-комната, не обмер квартиры. Окно на дальней стене, дверь слева у входа.',
  }
  const review = await reviewConceptImage(key, image, brief, reference)
  const equipment = sample.equipment ? new RegExp(sample.equipment, 'i') : null
  // The original request is ambiguous about replacing the furniture. Read these
  // observations against the images; a regex cannot distinguish a TV from its cabinet.
  const statusMatches =
    sample.expected === 'visual-review' ? null : review.status === sample.expected
  const passed =
    statusMatches &&
    (!equipment ||
      review.issues.some(
        (issue) => issue.code === 'brief_conflict' && equipment.test(issue.detail),
      ))
  failures += Number(passed === false || review.status === 'unavailable')
  const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex')
  await writeFile(
    output,
    `${JSON.stringify(
      {
        sample,
        brief,
        source: reference ? { path: referencePath, sha256: hash(reference.body) } : null,
        result: { path: imagePath, sha256: hash(image.body) },
        passed,
        review,
      },
      null,
      2,
    )}\n`,
  )
  console.log(JSON.stringify({ id: sample.id, expected: sample.expected, passed, review }))
}
process.exitCode = failures ? 1 : 0
