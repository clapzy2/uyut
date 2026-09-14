/**
 * Paid comparison of the two renderer finalists on free real-room photographs.
 * Two runs per source expose lucky generations. Results and source copies stay ignored locally.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildTemplatePlan,
  type ConceptBrief,
  type ConceptModelId,
  conceptModels,
  createFalRenderer,
  falQueue,
  styleLibrary,
  toDataUri,
} from '@uyut/ai'
import sharp from 'sharp'

const MODELS = [
  'nano-banana-2',
  'gpt-image-2.5-sunburst',
] as const satisfies readonly ConceptModelId[]
const RUNS = 2
const MAX_IMAGES = 12
const directory = process.env.REFERENCE_BENCH_DIR
  ? resolve(process.env.REFERENCE_BENCH_DIR)
  : fileURLToPath(new URL('../../output/model-bench-real-v1/', import.meta.url))
const apiKey = process.env.FAL_KEY ?? ''
if (!apiKey) throw new Error('FAL_KEY required')
if (!process.argv.includes('--generate'))
  throw new Error('Pass --generate to authorize paid renders')

type SourceCase = {
  id: string
  sourcePage: string
  sourceImage: string
  author: string
  license: string
  brief: Omit<ConceptBrief, 'primaryStyle' | 'secondaryStyles' | 'families'>
}

const sources: SourceCase[] = [
  {
    id: 'living-window-doorway',
    sourcePage: 'https://unsplash.com/photos/ZWHajYLVsKo',
    sourceImage:
      'https://images.unsplash.com/photo-1722859179261-dd72877cb7c3?auto=format&fit=crop&fm=jpg&q=85&w=1800',
    author: 'Alex Tyson',
    license: 'Unsplash License',
    brief: {
      roomKind: 'living',
      roomName: 'Гостиная с окнами и широким проёмом',
      areaM2: null,
      condition: 'finished',
      notes:
        'Гостиная для двух взрослых: диван, ТВ-зона и компактное рабочее место. Не перекрывать окна и широкий проход в соседнюю комнату.',
      hasPhoto: true,
      budgetKopecks: 80_000_000,
      household: {
        adults: 2,
        kids: 0,
        pets: false,
        cookHome: true,
        receiveGuests: true,
        wfh: true,
      },
    },
  },
  {
    id: 'bedroom-two-doors',
    sourcePage: 'https://www.pexels.com/photo/35493898/',
    sourceImage:
      'https://images.pexels.com/photos/35493898/pexels-photo-35493898/free-photo-of-empty-carpeted-room-with-two-doors-and-window.jpeg?auto=compress&dpr=1&w=1800',
    author: 'Peter Vang',
    license: 'Pexels License',
    brief: {
      roomKind: 'bedroom',
      roomName: 'Спальня с двумя дверями и окном',
      areaM2: null,
      condition: 'finished',
      notes:
        'Спальня для двух взрослых: двуспальная кровать, два прикроватных столика и закрытое хранение. Сохранить окно и обе двери, не перекрывать проходы.',
      hasPhoto: true,
      budgetKopecks: 80_000_000,
      household: {
        adults: 2,
        kids: 0,
        pets: false,
        cookHome: false,
        receiveGuests: false,
        wfh: false,
      },
    },
  },
  {
    id: 'compact-kitchen-window',
    sourcePage: 'https://www.pexels.com/photo/19857231/',
    sourceImage:
      'https://images.pexels.com/photos/19857231/pexels-photo-19857231.jpeg?auto=compress&dpr=1&w=1800',
    author: 'Lisa Anna',
    license: 'Pexels License',
    brief: {
      roomKind: 'kitchen',
      roomName: 'Компактная кухня с окном',
      areaM2: null,
      condition: 'finished',
      notes:
        'Освежить небольшую кухню без острова. Сохранить окно, мойку, плиту, вытяжку и встроенную технику. Добавить удобное место для завтрака двух человек, не перекрывая шкафы и проход.',
      hasPhoto: true,
      budgetKopecks: 80_000_000,
      household: {
        adults: 2,
        kids: 0,
        pets: false,
        cookHome: true,
        receiveGuests: false,
        wfh: false,
      },
    },
  },
]

if (sources.length * MODELS.length * RUNS > MAX_IMAGES) throw new Error('Paid image cap exceeded')

type PreservationReview = {
  camera: number
  geometry: number
  openings: number
  fixedElements: number
  realism: number
  brief: number
  fatalIssues: string[]
  note: string
}

type BenchRow = {
  source: string
  model: ConceptModelId
  run: number
  status: 'ready' | 'failed'
  estimatedUsd: number
  review?: PreservationReview
  error?: string
}

function parseReview(raw: string): PreservationReview | null {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    const scores = ['camera', 'geometry', 'openings', 'fixedElements', 'realism', 'brief'] as const
    if (
      scores.some(
        (key) => typeof value[key] !== 'number' || Number(value[key]) < 0 || Number(value[key]) > 5,
      )
    )
      return null
    if (!Array.isArray(value.fatalIssues) || typeof value.note !== 'string') return null
    return {
      camera: Number(value.camera),
      geometry: Number(value.geometry),
      openings: Number(value.openings),
      fixedElements: Number(value.fixedElements),
      realism: Number(value.realism),
      brief: Number(value.brief),
      fatalIssues: value.fatalIssues
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 5),
      note: value.note.slice(0, 400),
    }
  } catch {
    return null
  }
}

async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Reference download failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function reviewPair(
  source: Buffer,
  candidate: Buffer,
  brief: ConceptBrief,
): Promise<PreservationReview | null> {
  const panelWidth = 720
  const panelHeight = 560
  const label = (text: string) =>
    Buffer.from(
      `<svg width="${panelWidth}" height="42" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="42" fill="#171112"/><text x="14" y="28" fill="white" font-family="Arial,sans-serif" font-size="20">${text}</text></svg>`,
    )
  const left = await sharp(source)
    .rotate()
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d8d2cf' })
    .composite([{ input: label('SOURCE'), left: 0, top: 0 }])
    .jpeg({ quality: 86 })
    .toBuffer()
  const right = await sharp(candidate)
    .rotate()
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d8d2cf' })
    .composite([{ input: label('CANDIDATE'), left: 0, top: 0 }])
    .jpeg({ quality: 86 })
    .toBuffer()
  const comparison = await sharp({
    create: { width: panelWidth * 2, height: panelHeight, channels: 3, background: '#d8d2cf' },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: panelWidth, top: 0 },
    ])
    .jpeg({ quality: 86 })
    .toBuffer()
  const result = await falQueue<{ output?: string }>(
    apiKey,
    'fal-ai/any-llm/vision',
    {
      model: 'anthropic/claude-sonnet-4.5',
      system_prompt:
        'Ты независимый проверяющий виртуального стейджинга. Слева исходная фотография SOURCE, справа результат CANDIDATE. Оцени только видимые факты. Не считай смену мебели и отделки ошибкой. Верни только JSON без markdown.',
      prompt: `Оцени CANDIDATE относительно SOURCE по шкале 0–5: camera — сохранены ракурс и кадрирование; geometry — сохранены стены, потолок, пол и пропорции; openings — сохранены количество, форма и положение видимых окон и дверей; fixedElements — сохранены видимые радиаторы, кондиционер, встроенная техника и иные стационарные элементы; realism — фотореализм без сломанной мебели; brief — выполнено пожелание. fatalIssues — только явные критические изменения архитектуры или невозможная мебель. note — одно короткое объяснение по-русски. Формат: {"camera":0,"geometry":0,"openings":0,"fixedElements":0,"realism":0,"brief":0,"fatalIssues":[],"note":""}. Пожелание: ${JSON.stringify(brief.notes)}`,
      image_url: toDataUri({ body: comparison, contentType: 'image/jpeg' }),
    },
    45_000,
  ).catch(() => null)
  return parseReview(result?.output ?? '')
}

await mkdir(directory, { recursive: true })
const style = styleLibrary[1]
if (!style) throw new Error('Missing benchmark style')
const rows: BenchRow[] = []

for (const sourceCase of sources) {
  const sourcePath = join(directory, `${sourceCase.id}--source.jpg`)
  const source = await readFile(sourcePath).catch(async () => {
    const downloaded = await fetchImage(sourceCase.sourceImage)
    const normalized = await sharp(downloaded).rotate().jpeg({ quality: 92 }).toBuffer()
    await writeFile(sourcePath, normalized)
    return normalized
  })
  const brief: ConceptBrief = {
    ...sourceCase.brief,
    primaryStyle: style,
    secondaryStyles: [],
    families: [style.family],
  }
  const plan = buildTemplatePlan(brief, 1)
  const prompt = `${plan.shared} ${plan.variations[0]} ${plan.mandate}`.replace(/\s+/g, ' ').trim()
  await writeFile(
    join(directory, `${sourceCase.id}--brief.json`),
    JSON.stringify({ source: sourceCase, prompt }, null, 2),
  )

  for (const model of MODELS) {
    for (let run = 1; run <= RUNS; run += 1) {
      const stem = `${sourceCase.id}--${model}--${run}`
      const resultPath = join(directory, `${stem}.json`)
      const cached = await readFile(resultPath, 'utf8')
        .then((raw) => JSON.parse(raw) as BenchRow)
        .catch(() => null)
      if (cached?.status === 'ready') {
        rows.push(cached)
        console.log(JSON.stringify({ ...cached, cached: true }))
        continue
      }
      console.log(JSON.stringify({ source: sourceCase.id, model, run, stage: 'render' }))
      try {
        const rendered = await createFalRenderer(apiKey, model).render({
          prompt,
          // A public source URL keeps the edit request small enough for every provider.
          imageUrl: sourceCase.sourceImage,
          aspectRatio: 'auto',
        })
        const candidate = await sharp(rendered.body).rotate().webp({ quality: 90 }).toBuffer()
        await writeFile(join(directory, `${stem}.webp`), candidate)
        const review = await reviewPair(source, candidate, brief)
        const row: BenchRow = {
          source: sourceCase.id,
          model,
          run,
          status: 'ready',
          estimatedUsd: conceptModels[model].usdPerImage,
          review: review ?? undefined,
        }
        await writeFile(resultPath, JSON.stringify(row, null, 2))
        rows.push(row)
        console.log(JSON.stringify(row))
      } catch (error) {
        const row: BenchRow = {
          source: sourceCase.id,
          model,
          run,
          status: 'failed',
          estimatedUsd: 0,
          error: error instanceof Error ? error.message.slice(0, 400) : String(error),
        }
        await writeFile(resultPath, JSON.stringify(row, null, 2))
        rows.push(row)
        console.error(JSON.stringify(row))
      }
    }
  }
}

const score = (review?: PreservationReview) =>
  review
    ? Number(
        (
          (review.camera +
            review.geometry +
            review.openings +
            review.fixedElements +
            review.realism +
            review.brief) /
          6
        ).toFixed(2),
      )
    : null
const byModel = MODELS.map((model) => {
  const modelRows = rows.filter((row) => row.model === model && row.status === 'ready')
  const scores = modelRows
    .map((row) => score(row.review))
    .filter((value): value is number => value !== null)
  return {
    model,
    ready: modelRows.length,
    reviewed: scores.length,
    averageScore: scores.length
      ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2))
      : null,
    fatalIssues: modelRows.reduce((sum, row) => sum + (row.review?.fatalIssues.length ?? 0), 0),
    estimatedUsd: Number(modelRows.reduce((sum, row) => sum + row.estimatedUsd, 0).toFixed(2)),
  }
})
const summary = {
  createdAt: new Date().toISOString(),
  sources: sources.map(({ id, sourcePage, author, license }) => ({
    id,
    sourcePage,
    author,
    license,
  })),
  runsPerModel: RUNS,
  images: rows.filter((row) => row.status === 'ready').length,
  estimatedUsd: Number(rows.reduce((sum, row) => sum + row.estimatedUsd, 0).toFixed(2)),
  byModel,
}
await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2))

const tileWidth = 360
const tileHeight = 270
const columns = 1 + MODELS.length * RUNS
const tiles: Array<{ input: Buffer; left: number; top: number }> = []
for (const [row, sourceCase] of sources.entries()) {
  const paths = [
    { path: join(directory, `${sourceCase.id}--source.jpg`), label: `${sourceCase.id} · SOURCE` },
    ...MODELS.flatMap((model) =>
      Array.from({ length: RUNS }, (_, index) => ({
        path: join(directory, `${sourceCase.id}--${model}--${index + 1}.webp`),
        label: `${conceptModels[model].label} · ${index + 1}`,
      })),
    ),
  ]
  for (const [column, item] of paths.entries()) {
    const image = await readFile(item.path)
    const overlay = Buffer.from(
      `<svg width="${tileWidth}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="34" fill="rgba(20,15,15,.85)"/><text x="10" y="23" fill="#fff" font-family="Arial,sans-serif" font-size="14">${item.label}</text></svg>`,
    )
    const tile = await sharp(image)
      .rotate()
      .resize(tileWidth, tileHeight, { fit: 'contain', background: '#d8d2cf' })
      .composite([{ input: overlay, left: 0, top: 0 }])
      .webp({ quality: 86 })
      .toBuffer()
    tiles.push({ input: tile, left: column * tileWidth, top: row * tileHeight })
  }
}
await sharp({
  create: {
    width: columns * tileWidth,
    height: sources.length * tileHeight,
    channels: 3,
    background: '#171112',
  },
})
  .composite(tiles)
  .webp({ quality: 88 })
  .toFile(join(directory, 'contact-sheet.webp'))

console.log(JSON.stringify(summary, null, 2))
