// Actual image reader, not a supplied JSON fixture. Two calls only; no project writes.
// bun --env-file=../../.env run scripts/bench-raster-plan-reading.ts IMAGE FRESH_DIR --run-paid
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  FLOOR_PLAN_PROMPT,
  PLAN_READER_ENDPOINT,
  PLAN_READER_MODEL,
  parseFloorPlan,
} from '@uyut/ai'
import { falQueue, toDataUri } from '../../../packages/ai/src/fal-queue'
import { planReaderPrompt } from '../../../packages/ai/src/floor-plan'
import { preparePlanPage } from '../lib/projects/plan-document'

const [imagePath, outputPath, flag, replayPath] = process.argv.slice(2)
if (
  !imagePath ||
  !outputPath ||
  !['--run-paid', '--replay'].includes(flag ?? '') ||
  (flag === '--replay' && !replayPath)
)
  throw new Error('Supply image, fresh directory and --run-paid or --replay RAW_DIRECTORY')
if (flag === '--run-paid' && replayPath) throw new Error('Paid mode cannot take a replay directory')
if (flag === '--run-paid' && !process.env.FAL_KEY)
  throw new Error('FAL_KEY unavailable; no paid requests made')
const body = await readFile(resolve(imagePath))
const sourceSha256 = createHash('sha256').update(body).digest('hex')
if (replayPath) {
  const manifest = JSON.parse(await readFile(join(resolve(replayPath), 'manifest.json'), 'utf8'))
  if (manifest.sourceSha256 !== sourceSha256) throw new Error('Replay source image differs')
}
const prepared = await preparePlanPage(body, false)
const output = resolve(outputPath)
await mkdir(output, { recursive: false })
await writeFile(join(output, 'input.jpg'), prepared.image.body)
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      sourceSha256: createHash('sha256').update(body).digest('hex'),
      model: PLAN_READER_MODEL,
      endpoint: PLAN_READER_ENDPOINT,
      promptSha256: createHash('sha256').update(FLOOR_PLAN_PROMPT).digest('hex'),
      width: prepared.image.width,
      height: prepared.image.height,
      calls: flag === '--run-paid' ? 2 : 0,
      projectWrites: 0,
    },
    null,
    2,
  ),
)
const summaries = []
for (let run = 1; run <= 2; run++) {
  const result: { output?: string; partial?: boolean; error?: string } =
    flag === '--replay'
      ? JSON.parse(await readFile(join(resolve(replayPath ?? ''), `raw-${run}.json`), 'utf8'))
      : await falQueue<{ output?: string; partial?: boolean; error?: string }>(
          process.env.FAL_KEY as string,
          PLAN_READER_ENDPOINT,
          {
            model: PLAN_READER_MODEL,
            system_prompt: FLOOR_PLAN_PROMPT,
            prompt: planReaderPrompt(prepared.image.planText),
            image_urls: [toDataUri(prepared.image)],
            temperature: 0,
            max_tokens: 12000,
          },
        )
  await writeFile(join(output, `raw-${run}.json`), JSON.stringify(result, null, 2))
  if (result.partial || result.error || !result.output?.trim())
    throw new Error(`Incomplete reader response at run ${run}; no retry`)
  const reading = parseFloorPlan(result.output, {
    requireMeasurementEvidence: true,
    planText: prepared.image.planText,
  })
  await writeFile(join(output, `reading-${run}.json`), JSON.stringify(reading, null, 2))
  summaries.push({
    run,
    rooms: reading.rooms.map((room) => ({
      name: room.name,
      areaM2: room.areaM2,
      widthCm: room.widthCm,
      depthCm: room.depthCm,
      utility: room.utility,
      measurementWarnings: room.measurementWarnings,
    })),
    geometry: reading.geometry
      ? {
          walls: reading.geometry.walls.length,
          openings: reading.geometry.openings.length,
          rooms: reading.geometry.rooms?.length ?? 0,
          footprint: !!reading.geometry.footprint,
          widthCm: reading.geometry.widthCm,
          heightCm: reading.geometry.heightCm,
        }
      : null,
  })
  await writeFile(join(output, 'summary.json'), JSON.stringify(summaries, null, 2))
  console.log(JSON.stringify(summaries.at(-1)))
}
