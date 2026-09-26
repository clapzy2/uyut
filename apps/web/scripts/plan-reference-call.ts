// Один оплачиваемый запрос для эталона листа 03. Без --run-paid только локальная растеризация.
// bun --env-file=../../.env run scripts/plan-reference-call.ts <pdf-path> [--run-paid]
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FLOOR_PLAN_PROMPT, PLAN_READER_MODEL, parseFloorPlan } from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import { falQueue, toDataUri } from '../../../packages/ai/src/fal-queue'
import { planReaderPrompt } from '../../../packages/ai/src/floor-plan'
import { preparePlanPage } from '../lib/projects/plan-document'

const path = process.argv[2]
if (!path || path.startsWith('--')) throw new Error('Укажите исходный PDF.')
const paid = process.argv.includes('--run-paid')
const nativeText = process.argv.includes('--with-native-text')
const directory = resolve(
  `../../output/quality-bench/plan-74-77${nativeText ? '-native-text' : ''}`,
)
const resultPath = resolve(directory, 'raw-answer.txt')
if (paid) {
  const exists = await access(resolve(directory, 'request.json')).then(
    () => true,
    () => false,
  )
  if (exists)
    throw new Error('Попытка уже записана. Повторный платный запрос запрещён этим сценарием.')
  if (!process.env.FAL_KEY) throw new Error('Нет FAL_KEY. Платный запрос не выполнялся.')
}
const body = await readFile(resolve(path))
if (createHash('sha256').update(body).digest('hex') !== reference.source.sha256) {
  throw new Error('PDF отличается от размеченного эталона. Запрос не выполнялся.')
}
const page = await preparePlanPage(body, true, reference.source.pdfPage)
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'page-6.jpg'), page.image.body)
if ('planText' in page.image)
  await writeFile(resolve(directory, 'text-layer.json'), String(page.image.planText))
console.log(
  JSON.stringify({
    mode: paid ? 'one-paid-request' : 'local-render-only',
    page: page.pageNumber,
    pageCount: page.pageCount,
  }),
)
if (paid) {
  const startedAt = new Date().toISOString()
  // Никаких циклов повтора, рендеров интерьера или дополнительного перечёта стен.
  const metadata = {
    startedAt,
    endpoint: 'fal-ai/any-llm/vision',
    model: PLAN_READER_MODEL,
    paidRequestAttempts: 1,
    quotedEstimateUsd: 0.03,
    actualChargeUsd: null,
    estimateSource: 'https://fal.ai/models/fal-ai/any-llm/vision/api',
    sourcePage: page.pageNumber,
    sourceSha256: reference.source.sha256,
    nativeText,
  }
  await writeFile(resolve(directory, 'request.json'), JSON.stringify(metadata, null, 2), {
    flag: 'wx',
  })
  const result = await falQueue<{ output?: string; partial?: boolean; error?: string }>(
    process.env.FAL_KEY as string,
    metadata.endpoint,
    {
      model: PLAN_READER_MODEL,
      system_prompt: FLOOR_PLAN_PROMPT,
      prompt: planReaderPrompt(
        nativeText && 'planText' in page.image ? page.image.planText : undefined,
      ),
      image_urls: [toDataUri(page.image)],
      temperature: 0,
      max_tokens: 12000,
    },
  )
  await writeFile(resolve(directory, 'response.json'), JSON.stringify(result, null, 2))
  if (result.partial || result.error || !result.output?.trim()) {
    throw new Error('Неполный ответ или ошибка читателя. Не повторяем запрос автоматически.')
  }
  await writeFile(resultPath, result.output)
  const reading = parseFloorPlan(result.output)
  await writeFile(resolve(directory, 'parsed.json'), JSON.stringify(reading, null, 2))
  console.log(
    JSON.stringify({
      rooms: reading.rooms.length,
      planState: reading.planState,
      answerPath: resultPath,
      actualChargeUsd: null,
    }),
  )
}
