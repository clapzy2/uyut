// Public complete PDF baseline. Same prepared image bytes, native text present vs absent.
// bun --env-file=../../.env run scripts/bench-basis-modalities.ts PDF FRESH_DIR [--run-paid] [--candidate-prompt]
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  FLOOR_PLAN_PROMPT,
  PLAN_READER_ENDPOINT,
  PLAN_READER_MODEL,
  parseFloorPlan,
  reconcileRasterReadings,
} from '@uyut/ai'
import sharp from 'sharp'
import { falQueue, toDataUri } from '../../../packages/ai/src/fal-queue'
import { planReaderPrompt } from '../../../packages/ai/src/floor-plan'
import { preparePlanPage } from '../lib/projects/plan-document'
import { evaluateBasisReader } from './basis-reader-evaluation'

const [pdfPath, outputPath, ...flags] = process.argv.slice(2)
if (
  !pdfPath ||
  !outputPath ||
  flags.some((flag) => flag !== '--run-paid' && flag !== '--candidate-prompt') ||
  new Set(flags).size !== flags.length
)
  throw new Error('Supply original PDF and fresh directory')
const runPaid = flags.includes('--run-paid')
const candidatePrompt = flags.includes('--candidate-prompt')
const systemPrompt = candidatePrompt
  ? (
      await readFile(
        new URL('../../../docs/qa/fixtures/plan-reader-candidate-20261009.txt', import.meta.url),
        'utf8',
      )
    ).trimEnd()
  : FLOOR_PLAN_PROMPT
const body = await readFile(resolve(pdfPath))
const sourceSha256 = createHash('sha256').update(body).digest('hex')
if (sourceSha256 !== 'eacadf4cf2a58a2f595ba192f3b9be49062f0215b49dffb3ccc920ee669b7eeb')
  throw new Error('BASIS source differs')
const page = await preparePlanPage(body, true, 3)
const output = resolve(outputPath)
await mkdir(output, { recursive: false })
await writeFile(join(output, 'input.jpg'), page.image.body)
await sharp(page.image.body).png().toFile(join(output, 'input.png'))
await writeFile(join(output, 'native-text.json'), page.image.planText ?? '')
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      sourceSha256,
      page: 3,
      sourceUrl: 'https://en.designartspace.com/storage/editor/BASIS_plan.pdf',
      model: PLAN_READER_MODEL,
      promptSha256: createHash('sha256').update(systemPrompt).digest('hex'),
      promptVariant: candidatePrompt ? 'qa-candidate-20261009' : 'default',
      imageSha256: createHash('sha256').update(page.image.body).digest('hex'),
      width: page.image.width,
      height: page.image.height,
      identicalImageBytesAcrossModes: true,
      plannedReaderCalls: runPaid ? 4 : 0,
      nativeMode: 'unreviewed PDF parser path',
      rasterMode: 'same rendered JPEG without native text; not upload/auth/storage E2E',
      projectWrites: 0,
    },
    null,
    2,
  ),
)
if (!runPaid) process.exit(0)
if (!process.env.FAL_KEY) throw new Error('No FAL_KEY; no paid request made')
const runs = []
for (const mode of ['native-text', 'image-only'] as const) {
  const readings = []
  const planText = mode === 'native-text' ? page.image.planText : undefined
  for (let run = 1; run <= 2; run++) {
    const raw = await falQueue<{ output?: string; partial?: boolean; error?: string }>(
      process.env.FAL_KEY,
      PLAN_READER_ENDPOINT,
      {
        model: PLAN_READER_MODEL,
        system_prompt: systemPrompt,
        prompt: planReaderPrompt(planText),
        image_urls: [toDataUri(page.image)],
        temperature: 0,
        max_tokens: 12000,
      },
    )
    await writeFile(join(output, `${mode}-${run}-raw.json`), JSON.stringify(raw, null, 2))
    if (raw.partial || raw.error || !raw.output?.trim())
      throw new Error(`Incomplete ${mode}/${run}; no automatic QA retry`)
    const parsed = parseFloorPlan(raw.output, { requireMeasurementEvidence: true, planText })
    await writeFile(join(output, `${mode}-${run}-parsed.json`), JSON.stringify(parsed, null, 2))
    readings.push(parsed)
    const summary = {
      mode,
      run,
      planState: parsed.planState,
      totalAreaM2: parsed.totalAreaM2,
      ceilingCm: parsed.ceilingCm,
      rooms: parsed.rooms.map((room) => ({
        sourceNumber: room.sourceNumber,
        name: room.name,
        spaceKind: room.spaceKind,
        areaM2: room.areaM2,
        widthCm: room.widthCm,
        depthCm: room.depthCm,
        ceilingCm: room.ceilingCm,
        measurementEvidence: room.measurementEvidence,
        measurementWarnings: room.measurementWarnings,
      })),
      geometry: parsed.geometry
        ? {
            walls: parsed.geometry.walls.length,
            openings: parsed.geometry.openings.length,
            rooms: parsed.geometry.rooms.length,
            widthCm: parsed.geometry.widthCm,
            heightCm: parsed.geometry.heightCm,
            footprint: !!parsed.geometry.footprint,
            warnings: parsed.geometry.warnings,
          }
        : null,
    }
    runs.push(summary)
    await writeFile(
      join(output, `${mode}-${run}-evaluation.json`),
      JSON.stringify(evaluateBasisReader(parsed), null, 2),
    )
    await writeFile(join(output, 'summary.json'), JSON.stringify(runs, null, 2))
    console.log(JSON.stringify(summary))
  }
  const first = readings[0],
    second = readings[1]
  if (!first || !second) throw new Error('Expected two readings')
  const application =
    mode === 'image-only' ? reconcileRasterReadings(first, second) : structuredClone(first)
  // Current readPlanFromStorage drops model PDF footprint without reviewed native floor proof.
  if (mode === 'native-text' && application.geometry) delete application.geometry.footprint
  await writeFile(join(output, `${mode}-application.json`), JSON.stringify(application, null, 2))
}
