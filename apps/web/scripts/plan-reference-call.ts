// Один оплачиваемый запрос для эталона листа 03. Без --run-paid только локальная растеризация.
// --reviewed-page: fresh source gate; --replay: saved response, no second paid call.
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FLOOR_PLAN_PROMPT,
  PLAN_READER_ENDPOINT,
  PLAN_READER_MODEL,
  parseFloorPlan,
} from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import features from '../../../docs/qa/fixtures/apartment-74-77-page-features.json'
import { falQueue, toDataUri } from '../../../packages/ai/src/fal-queue'
import { planReaderPrompt } from '../../../packages/ai/src/floor-plan'
import { preparePlanPage } from '../lib/projects/plan-document'
import { planPageContoursSchema, planPageFeaturesIssue } from '../lib/projects/plan-page-review'
import { pdfContourIssue } from '../lib/projects/plan-pdf-room-binding'
import { verifyPlanReadingGeometry } from '../lib/projects/plan-reading-geometry'
import { evaluateDeclaredPlanReference, evaluatePlanReference } from './plan-reference-evaluation'

const path = process.argv[2]
if (!path || path.startsWith('--')) throw new Error('Укажите исходный PDF.')
const paid = process.argv.includes('--run-paid')
const replay = process.argv.includes('--replay')
const reviewedPage = process.argv.includes('--reviewed-page')
const nativeText = reviewedPage || process.argv.includes('--with-native-text')
if (paid && replay) throw new Error('Повторная сверка не может запускать платное чтение.')
const suffix = reviewedPage ? '-reviewed-page' : nativeText ? '-native-text' : ''
const directory = resolve(`../../output/quality-bench/plan-74-77${suffix}`)
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
const page = await preparePlanPage(body, true, reference.source.pdfPage, reviewedPage)
// Only the three reviewed room polygons are supplied to the local gate. Control dimensions,
// selected reference chains and annotations are NEVER added to the model's prompt.
const contours = reviewedPage
  ? planPageContoursSchema.parse({
      source: {
        sha256: reference.source.sha256,
        pdfPage: reference.source.pdfPage,
        state: 'existing',
      },
      coordinateSystem: features.coordinateSystem,
      review: features.review,
      pageWidth: features.pageWidth,
      pageHeight: features.pageHeight,
      rooms: features.rooms
        .filter((room) => [2, 3, 4].includes(room.roomSourceNumber))
        .map((room) => ({
          roomSourceNumber: room.roomSourceNumber,
          polygon: room.polygon,
          openings: room.openings.map(({ id, wallEdgeIndex, start, end }) => ({
            id,
            kind: 'door',
            wallEdgeIndex,
            start,
            end,
          })),
        })),
    })
  : undefined
if (
  contours &&
  (!page.linework ||
    !page.image.planText ||
    pdfContourIssue(page.linework, contours.source, contours) ||
    planPageFeaturesIssue(contours, { checkRoomOverlap: true }))
)
  throw new Error('Исходный нативный слой или разметка требуют уточнения. Запрос не выполнялся.')
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'page-6.jpg'), page.image.body)
if ('planText' in page.image)
  await writeFile(resolve(directory, 'text-layer.json'), String(page.image.planText))
console.log(
  JSON.stringify({
    mode: paid ? 'one-paid-request' : replay ? 'saved-response-replay' : 'local-render-only',
    page: page.pageNumber,
    pageCount: page.pageCount,
  }),
)
let result:
  | {
      output?: string
      partial?: boolean
      error?: string
      usage?: {
        cost?: number
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
      }
    }
  | undefined
if (paid) {
  const startedAt = new Date().toISOString()
  // Никаких циклов повтора, рендеров интерьера или дополнительного перечёта стен.
  const metadata = {
    startedAt,
    endpoint: PLAN_READER_ENDPOINT,
    model: PLAN_READER_MODEL,
    paidRequestAttempts: 1,
    quotedEstimateUsd: null,
    actualChargeUsd: null,
    pricingMode: 'actual-token-usage',
    maxOutputTokens: 12000,
    pricingSource: 'https://fal.ai/models/openrouter/router/vision/api',
    sourcePage: page.pageNumber,
    sourceSha256: reference.source.sha256,
    nativeText,
    reviewedRoomNumbers: contours?.rooms.map((room) => room.roomSourceNumber) ?? [],
    promptSha256: createHash('sha256')
      .update(FLOOR_PLAN_PROMPT + planReaderPrompt(nativeText ? page.image.planText : undefined))
      .digest('hex'),
  }
  await writeFile(resolve(directory, 'request.json'), JSON.stringify(metadata, null, 2), {
    flag: 'wx',
  })
  result = await falQueue<NonNullable<typeof result>>(
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
}
if (replay) result = JSON.parse(await readFile(resolve(directory, 'response.json'), 'utf8'))
if (result) {
  if (result.partial || result.error || !result.output?.trim()) {
    throw new Error('Неполный ответ или ошибка читателя. Не повторяем запрос автоматически.')
  }
  await writeFile(resultPath, result.output)
  const legacyReading = parseFloorPlan(result.output)
  const parsed = parseFloorPlan(result.output, {
    requireMeasurementEvidence: true,
    planText: nativeText ? page.image.planText : undefined,
  })
  const reading =
    contours && page.linework
      ? verifyPlanReadingGeometry(
          { ...parsed, sourcePage: page.pageNumber, pageCount: page.pageCount },
          {
            source: contours.source,
            contours,
            linework: page.linework,
            planText: page.image.planText,
          },
        )
      : parsed
  await writeFile(resolve(directory, 'parsed.json'), JSON.stringify(reading, null, 2))
  const recordedRequest = JSON.parse(await readFile(resolve(directory, 'request.json'), 'utf8'))
  const evaluation = {
    sourceSha256: reference.source.sha256,
    sourcePage: page.pageNumber,
    model: recordedRequest.model,
    endpoint: recordedRequest.endpoint,
    requestPromptSha256: recordedRequest.promptSha256,
    currentPromptMatchesRequest:
      recordedRequest.promptSha256 ===
      createHash('sha256')
        .update(FLOOR_PLAN_PROMPT + planReaderPrompt(nativeText ? page.image.planText : undefined))
        .digest('hex'),
    paidCallsThisExecution: paid ? 1 : 0,
    providerReportedUsage: result.usage ?? null,
    reviewedRoomNumbers: contours?.rooms.map((room) => room.roomSourceNumber) ?? [],
    declaredAnswer: evaluateDeclaredPlanReference(result.output),
    legacyParser: evaluatePlanReference(legacyReading),
    strictParser: evaluatePlanReference(parsed),
    ...(contours ? { geometryGate: evaluatePlanReference(reading) } : {}),
  }
  await writeFile(resolve(directory, 'evaluation.json'), JSON.stringify(evaluation, null, 2))
  console.log(
    JSON.stringify({
      rooms: reading.rooms.length,
      planState: reading.planState,
      answerPath: resultPath,
      declaredAnswer: evaluation.declaredAnswer.summary,
      legacyParser: evaluation.legacyParser.summary,
      strictParser: evaluation.strictParser.summary,
      geometryGate: evaluation.geometryGate?.summary,
      providerReportedUsage: result.usage ?? null,
      actualInvoiceChargeUsd: null,
    }),
  )
}
