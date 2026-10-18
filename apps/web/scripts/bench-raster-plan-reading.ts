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
  reconcileRasterReadings,
} from '@uyut/ai'
import { z } from 'zod'
import { falQueue, toDataUri } from '../../../packages/ai/src/fal-queue'
import { planReaderPrompt } from '../../../packages/ai/src/floor-plan'
import { preparePlanPage } from '../lib/projects/plan-document'

// Optional independent labels: --expectations FILE (after the replay directory).
// The fixture is source-bound: { sourceSha256, rooms: [{ name, areaM2?, widthCm?, depthCm? }] }.
const args = process.argv.slice(2)
const [imagePath, outputPath, flag] = args
const replayPath = flag === '--replay' ? args[3] : undefined
const optionalArgs = args.slice(flag === '--replay' ? 4 : 3)
if (
  optionalArgs.length !== 0 &&
  (optionalArgs.length !== 2 || optionalArgs[0] !== '--expectations' || !optionalArgs[1])
)
  throw new Error('Only --expectations FILE is allowed after mode arguments')
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
const fixtureSchema = z
  .object({
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    rooms: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            areaM2: z.number().positive().finite().optional(),
            widthCm: z.number().positive().finite().optional(),
            depthCm: z.number().positive().finite().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
const expectations = optionalArgs[1]
  ? fixtureSchema.parse(JSON.parse(await readFile(resolve(optionalArgs[1]), 'utf8')))
  : null
if (expectations && expectations.sourceSha256 !== sourceSha256)
  throw new Error('Expectations source image differs; no paid requests made')
const normalizeName = (name: string) => name.trim().toLocaleLowerCase('ru-RU')
if (
  expectations &&
  new Set(expectations.rooms.map((room) => normalizeName(room.name))).size !==
    expectations.rooms.length
)
  throw new Error('Duplicate expectation room labels; no paid requests made')
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
type ReadingRoom = ReturnType<typeof parseFloorPlan>['rooms'][number]
type ReadingSummary = {
  run: number
  rooms: Pick<
    ReadingRoom,
    'name' | 'areaM2' | 'widthCm' | 'depthCm' | 'utility' | 'measurementWarnings'
  >[]
  geometry: {
    walls: number
    openings: number
    rooms: number
    footprint: boolean
    widthCm: number
    heightCm: number
  } | null
}
const summaries: ReadingSummary[] = []
const readings: ReturnType<typeof parseFloorPlan>[] = []
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
    keepNameOnlyCandidates: true,
  })
  await writeFile(join(output, `reading-${run}.json`), JSON.stringify(reading, null, 2))
  readings.push(reading)
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

// Agreement between runs is repeatability only, never independent correctness evidence.
const metrics = ['areaM2', 'widthCm', 'depthCm'] as const
const roomNames = new Set([
  ...summaries.flatMap((summary) => summary.rooms.map((room) => normalizeName(room.name))),
  ...(expectations?.rooms.map((room) => normalizeName(room.name)) ?? []),
])
const firstReading = readings[0],
  secondReading = readings[1]
if (!firstReading || !secondReading) throw new Error('Two readings required')
await writeFile(
  join(output, 'reconciled.json'),
  JSON.stringify(reconcileRasterReadings(firstReading, secondReading), null, 2),
)
const comparison = {
  sourceSha256,
  evidence: expectations ? 'independently-supplied-labels' : 'no-independent-labels',
  correctnessProven: false,
  rooms: [...roomNames].map((name) => {
    const matches = summaries.map((summary) =>
      summary.rooms.filter((room) => normalizeName(room.name) === name),
    )
    const expected = expectations?.rooms.find((room) => normalizeName(room.name) === name)
    return {
      name,
      matchCounts: matches.map((rooms) => rooms.length),
      metrics: metrics.map((metric) => {
        const values = matches.map((rooms) =>
          rooms.length === 1 ? (rooms[0]?.[metric] ?? null) : null,
        )
        const target = expected?.[metric] ?? null
        return {
          metric,
          values,
          repeatability: values.some((value) => value === null)
            ? 'unknown'
            : values[0] === values[1]
              ? 'agreement'
              : 'disagreement',
          expected: target,
          deviations: values.map((value) =>
            value === null || target === null ? null : Number((value - target).toFixed(6)),
          ),
          independentComparison: target === null ? 'unknown' : 'label-only-not-geometric-proof',
        }
      }),
    }
  }),
  geometry: {
    runs: summaries.map((summary) => summary.geometry),
    countAgreement: summaries.every((summary) => summary.geometry !== null)
      ? {
          walls: summaries[0]?.geometry?.walls === summaries[1]?.geometry?.walls,
          openings: summaries[0]?.geometry?.openings === summaries[1]?.geometry?.openings,
          rooms: summaries[0]?.geometry?.rooms === summaries[1]?.geometry?.rooms,
        }
      : null,
    topologyComparison: 'not-performed',
    completeness: 'unknown',
  },
}
await writeFile(join(output, 'comparison.json'), JSON.stringify(comparison, null, 2))
