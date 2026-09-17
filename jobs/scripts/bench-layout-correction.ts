/** One paid, cached regression for the missing-layout-item correction path. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  conceptModels,
  createFalRenderer,
  isLayoutCorrectionImprovement,
  layoutCorrectionPrompt,
  reviewConceptImage,
} from '@uyut/ai'
import type { ConceptQualityReview } from '@uyut/db'
import sharp from 'sharp'

const MODEL = 'gpt-image-2.5-sunburst' as const
const caseId = 'bedroom-storage-v1'
const sourceDirectory = resolve(process.env.LAYOUT_FIDELITY_DIR ?? 'output/layout-fidelity-v1')
const outputDirectory = resolve(process.env.LAYOUT_CORRECTION_DIR ?? 'output/layout-correction-v1')
const sourceImagePath = join(sourceDirectory, `${caseId}--${MODEL}.webp`)
const sourceReportPath = join(sourceDirectory, `${caseId}--${MODEL}.json`)
const outputImagePath = join(outputDirectory, `${caseId}--${MODEL}.webp`)
const outputReportPath = join(outputDirectory, `${caseId}--${MODEL}.json`)

const cached = await readFile(outputReportPath, 'utf8').catch(() => null)
if (cached) {
  console.log(JSON.stringify({ caseId, model: MODEL, cached: true, report: outputReportPath }))
  process.exit(0)
}
if (!process.argv.includes('--generate')) {
  throw new Error('Pass --generate to authorize exactly one paid correction render')
}
const apiKey = process.env.FAL_KEY
if (!apiKey) throw new Error('FAL_KEY required')

const [sourceImage, rawSourceReport] = await Promise.all([
  readFile(sourceImagePath),
  readFile(sourceReportPath, 'utf8'),
])
const sourceReport = JSON.parse(rawSourceReport) as { layoutContract?: string }
if (!sourceReport.layoutContract) throw new Error('Source report has no layout contract')

const before: ConceptQualityReview = {
  version: 1,
  status: 'review',
  model: 'anthropic/claude-sonnet-4.5',
  checkedAt: new Date().toISOString(),
  description: 'Спальня с двуспальной кроватью, окном и низким хранением.',
  issues: [
    {
      code: 'requirement_unconfirmed',
      detail:
        'Не подтверждено: полноразмерный шкаф не виден; предмет на переднем плане выглядит низкой тумбой.',
      confidence: 0.85,
    },
  ],
}
const correctionPrompt = layoutCorrectionPrompt(before, sourceReport.layoutContract)
if (!correctionPrompt) throw new Error('Correction prompt was not produced')

console.log(JSON.stringify({ caseId, model: MODEL, stage: 'render', paidRenderCap: 1 }))
const corrected = await createFalRenderer(apiKey, MODEL).render({
  prompt: correctionPrompt,
  imageUrl: `data:image/webp;base64,${sourceImage.toString('base64')}`,
  aspectRatio: '4:3',
})
const outputImage = await sharp(corrected.body).webp({ quality: 90 }).toBuffer()
const reviewImage = await sharp(outputImage)
  .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()
const after = await reviewConceptImage(
  apiKey,
  { body: reviewImage, contentType: 'image/jpeg' },
  {
    roomKind: 'bedroom',
    layoutNotes:
      'На верхней стене одно окно шириной 180 см; на нижней стене у левого угла одна дверь шириной 90 см. Других проёмов нет.',
    layoutContract: sourceReport.layoutContract,
    notes:
      'Нужны двуспальная кровать, шкаф и комод; окно и проход от двери должны остаться свободными.',
    household: { adults: 2, kids: 0, pets: false },
  },
)
const accepted = isLayoutCorrectionImprovement(before, after)
await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeFile(outputImagePath, outputImage),
  writeFile(
    outputReportPath,
    JSON.stringify(
      {
        caseId,
        model: MODEL,
        createdAt: new Date().toISOString(),
        paidRenderCount: 1,
        estimatedRenderUsd: conceptModels[MODEL].usdPerImage,
        accepted,
        before,
        after,
        correctionPrompt,
      },
      null,
      2,
    ),
  ),
])
console.log(
  JSON.stringify({
    caseId,
    model: MODEL,
    stage: 'done',
    accepted,
    estimatedRenderUsd: conceptModels[MODEL].usdPerImage,
    after,
  }),
)
