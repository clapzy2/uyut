import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type ConceptModelId, createFalRenderer } from '../../../packages/ai/src/fal'
import { toDataUri } from '../../../packages/ai/src/fal-queue'
import {
  buildTemplatePlan,
  roomRenderAspectRatio,
  styleOrDefault,
} from '../../../packages/ai/src/prompt'
import { reviewConceptImage } from '../../../packages/ai/src/quality-review'
import type { ConceptBrief } from '../../../packages/ai/src/types'

const models: ConceptModelId[] = ['gpt-image-2.5-sunburst', 'nano-banana-2', 'nano-banana-pro']
const caseIds = [
  'compact-kitchen-window',
  'bedroom-two-doors',
  'living-window-doorway',
  'kid-two-openings',
]
const sourceDirectory = resolve('../../output/model-bench-real-v1')

export function benchmarkConfig(args: string[]) {
  if (
    args.length !== 2 ||
    !['prepare', 'render', 'review', 'paired', 'sheets'].includes(args[0] ?? '')
  ) {
    throw new Error('Укажите prepare/render/review/paired/sheets и уникальный run-id.')
  }
  const runId = args[1] ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(runId)) throw new Error('Некорректный run-id.')
  return { mode: args[0], runId }
}

export function renderReservation(model: ConceptModelId) {
  // Conservative reservation, not a measured invoice. GPT billing depends on tokens.
  return model === 'nano-banana-2' ? 0.08 : model === 'nano-banana-pro' ? 0.15 : 0.5
}

export function validateManifest(manifest: Manifest, runId: string) {
  if (manifest.runId !== runId || manifest.cases.length !== 4 || manifest.jobs.length !== 24) {
    throw new Error('Некорректный manifest.')
  }
  const expectedIds = caseIds.flatMap((caseId) =>
    models.flatMap((model) => [1, 2].map((repetition) => `${caseId}--${model}--${repetition}`)),
  )
  if (new Set(manifest.cases.map((sample) => sample.id)).size !== 4)
    throw new Error('Повтор сценария.')
  for (const sample of manifest.cases) {
    const expectedSource = sample.id === 'kid-two-openings' ? 'bedroom-two-doors' : sample.id
    if (
      !caseIds.includes(sample.id) ||
      sample.sourceId !== expectedSource ||
      !/^[a-f0-9]{64}$/.test(sample.sourceSha256) ||
      sample.prompt !== promptForCase(sample.brief)
    ) {
      throw new Error('Изменился сценарий или исходник.')
    }
  }
  for (const [index, job] of manifest.jobs.entries()) {
    if (
      job.id !== expectedIds[index] ||
      !models.includes(job.model) ||
      job.id !== `${job.caseId}--${job.model}--${job.repetition}` ||
      job.reservationUsd !== renderReservation(job.model)
    )
      throw new Error('Изменился список запросов.')
  }
  const reservation = manifest.jobs.reduce((sum, job) => sum + job.reservationUsd, 0)
  if (
    !Number.isFinite(manifest.reservedRenderUsd) ||
    reservation > 12 ||
    Math.abs(reservation - manifest.reservedRenderUsd) > 0.000001
  ) {
    throw new Error('Превышен или изменён резерв рендеров.')
  }
}

export function promptForCase(brief: ConceptBrief) {
  const plan = buildTemplatePlan(brief, 1)
  return [plan.shared, plan.variations[0], plan.mandate].filter(Boolean).join(' ')
}

type BenchCase = {
  id: string
  sourceId: string
  brief: ConceptBrief
  prompt: string
  sourceSha256: string
}
type BenchJob = {
  id: string
  caseId: string
  model: ConceptModelId
  repetition: number
  reservationUsd: number
}
type Manifest = { runId: string; cases: BenchCase[]; jobs: BenchJob[]; reservedRenderUsd: number }

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  )
}

async function save(path: string, value: unknown, exclusive = false) {
  await writeFile(path, JSON.stringify(value, null, 2), exclusive ? { flag: 'wx' } : {})
}

async function prepare(directory: string, runId: string) {
  if (await exists(resolve(directory, 'manifest.json')))
    throw new Error('Этот run-id уже подготовлен.')
  const cases: BenchCase[] = []
  for (const id of caseIds) {
    const sourceId = id === 'kid-two-openings' ? 'bedroom-two-doors' : id
    const previous = JSON.parse(
      await readFile(resolve(sourceDirectory, `${sourceId}--brief.json`), 'utf8'),
    )
    const primaryStyle = styleOrDefault(undefined)
    const brief: ConceptBrief = {
      ...previous.source.brief,
      primaryStyle,
      secondaryStyles: [],
      families: [],
      ...(id === 'kid-two-openings'
        ? {
            roomKind: 'kid' as const,
            roomName: 'Детская в комнате с двумя существующими проёмами',
            household: { adults: 2, kids: 1, pets: false, wfh: false },
            notes:
              'Детская для одного школьника: одна кровать, рабочий стол со стулом и закрытый шкаф для одежды. Сохранить окно, оба существующих проёма с дверцами и потолочную вентиляционную решётку. Не перекрывать их мебелью. Без двухъярусной кровати.',
          }
        : {}),
    }
    const body = await readFile(resolve(sourceDirectory, `${sourceId}--source.jpg`))
    const sourceSha256 = createHash('sha256').update(body).digest('hex')
    cases.push({ id, sourceId, brief, prompt: promptForCase(brief), sourceSha256 })
    await save(resolve(directory, `${id}--case.json`), {
      ...cases.at(-1),
      provenance: previous.source,
    })
  }
  const jobs = cases.flatMap((sample) =>
    models.flatMap((model) =>
      [1, 2].map((repetition) => ({
        id: `${sample.id}--${model}--${repetition}`,
        caseId: sample.id,
        model,
        repetition,
        reservationUsd: renderReservation(model),
      })),
    ),
  )
  const reservedRenderUsd = jobs.reduce((sum, job) => sum + job.reservationUsd, 0)
  if (reservedRenderUsd > 12) throw new Error('Превышен согласованный резерв рендеров.')
  await save(resolve(directory, 'manifest.json'), { runId, cases, jobs, reservedRenderUsd }, true)
  console.log(JSON.stringify({ mode: 'prepared', jobs: jobs.length, reservedRenderUsd }))
}

async function runPaid(
  directory: string,
  manifest: Manifest,
  mode: 'render' | 'review' | 'paired',
) {
  const configuredKey = process.env.FAL_KEY
  if (!configuredKey) throw new Error('FAL_KEY отсутствует; платных обращений нет.')
  const apiKey: string = configuredKey
  // Six preselected controls, not a second review of all 24 outputs or an adaptive rerender.
  const jobs =
    mode === 'paired'
      ? manifest.jobs.filter(
          (job) =>
            job.repetition === 2 &&
            ['compact-kitchen-window', 'kid-two-openings'].includes(job.caseId),
        )
      : manifest.jobs
  // Mark the entire phase before submitting anything; never re-submit on restart or timeout.
  await save(
    resolve(directory, `${mode}-started.json`),
    { startedAt: new Date().toISOString(), attemptsLimit: jobs.length },
    true,
  )
  let next = 0
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++]
      if (!job) continue
      const sample = manifest.cases.find((entry) => entry.id === job.caseId)
      if (!sample) throw new Error('Нет сценария.')
      const base = resolve(directory, job.id)
      const model = job.model
      const startedAt = Date.now()
      await save(
        `${base}--${mode}-attempt.json`,
        { ...job, startedAt: new Date().toISOString() },
        true,
      )
      try {
        if (mode === 'render') {
          const source = await readFile(resolve(sourceDirectory, `${sample.sourceId}--source.jpg`))
          if (createHash('sha256').update(source).digest('hex') !== sample.sourceSha256)
            throw new Error('Изменился исходник.')
          const result = await createFalRenderer(apiKey, model, { timeoutMs: 240_000 }).render({
            prompt: sample.prompt,
            imageUrl: toDataUri({ body: source, contentType: 'image/jpeg' }),
            aspectRatio: roomRenderAspectRatio(sample.brief),
          })
          await writeFile(`${base}.image`, result.body, { flag: 'wx' })
          await save(`${base}--render-result.json`, {
            ...job,
            status: 'generated',
            contentType: result.contentType,
            imageSha256: createHash('sha256').update(result.body).digest('hex'),
            promptSha256: createHash('sha256').update(sample.prompt).digest('hex'),
            durationMs: Date.now() - startedAt,
            actualChargeUsd: null,
          })
        } else {
          const metadata = JSON.parse(await readFile(`${base}--render-result.json`, 'utf8'))
          if (metadata.status !== 'generated') throw new Error('Нет успешного рендера.')
          const body = await readFile(`${base}.image`)
          if (createHash('sha256').update(body).digest('hex') !== metadata.imageSha256) {
            throw new Error('Изменился проверяемый рендер.')
          }
          const reference =
            mode === 'paired'
              ? {
                  body: await readFile(resolve(sourceDirectory, `${sample.sourceId}--source.jpg`)),
                  contentType: 'image/jpeg',
                }
              : undefined
          if (
            reference &&
            createHash('sha256').update(reference.body).digest('hex') !== sample.sourceSha256
          ) {
            throw new Error('Изменился исходник парной проверки.')
          }
          const review = await reviewConceptImage(
            apiKey,
            { body, contentType: metadata.contentType },
            sample.brief,
            reference,
          )
          await save(`${base}--${mode}-result.json`, {
            ...job,
            review,
            durationMs: Date.now() - startedAt,
            actualChargeUsd: null,
          })
        }
        console.log(
          JSON.stringify({
            job: job.id,
            phase: mode,
            completed: true,
            durationMs: Date.now() - startedAt,
          }),
        )
      } catch (error) {
        await save(`${base}--${mode}-error.json`, {
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        })
        console.log(JSON.stringify({ job: job.id, phase: mode, completed: false }))
      }
    }
  }
  await Promise.all([worker(), worker()])
}

async function sheets(directory: string, manifest: Manifest) {
  const sharp = (await import('sharp')).default
  for (const sample of manifest.cases) {
    const jobs = manifest.jobs.filter((job) => job.caseId === sample.id)
    const width = 450
    const height = 360
    const entries = [
      { label: 'SOURCE', path: resolve(sourceDirectory, `${sample.sourceId}--source.jpg`) },
      ...jobs.map((job) => ({
        label: `${models.indexOf(job.model) + 1} / ${job.repetition}`,
        path: resolve(directory, `${job.id}.image`),
      })),
    ]
    const layers = []
    for (const [index, entry] of entries.entries()) {
      if (!(await exists(entry.path))) continue
      const tile = await sharp(entry.path)
        .resize(width, height - 30, { fit: 'contain', background: '#202020' })
        .png()
        .toBuffer()
      const left = (index % 3) * width
      const top = Math.floor(index / 3) * height
      layers.push({ input: tile, left, top: top + 30 })
      layers.push({
        input: Buffer.from(
          `<svg width="450" height="30"><text x="10" y="21" fill="white" font-size="18">${entry.label}</text></svg>`,
        ),
        left,
        top,
      })
    }
    await sharp({
      create: { width: width * 3, height: height * 3, channels: 3, background: '#202020' },
    })
      .composite(layers)
      .png()
      .toFile(resolve(directory, `${sample.id}--sheet.png`))
  }
}

async function main() {
  const config = benchmarkConfig(process.argv.slice(2))
  const directory = resolve(`../../output/model-bench-${config.runId}`)
  await mkdir(directory, { recursive: true })
  if (config.mode === 'prepare') return prepare(directory, config.runId)
  const manifest: Manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
  validateManifest(manifest, config.runId)
  if (config.mode === 'sheets') return sheets(directory, manifest)
  await runPaid(directory, manifest, config.mode as 'render' | 'review' | 'paired')
}

if (import.meta.main) await main()
