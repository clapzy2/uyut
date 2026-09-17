/** One paid layout-fidelity render. Local synthetic data only, no retry and no upload. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  buildTemplatePlan,
  type ConceptBrief,
  conceptModels,
  createFalRenderer,
  falQueue,
  roomRenderAspectRatio,
  styleLibrary,
  toDataUri,
} from '@uyut/ai'
import { type LayoutItem, layoutPromptContract, layoutRoom, type RoomLayout } from '@uyut/catalog'
import sharp from 'sharp'

const MODEL = 'gpt-image-2.5-sunburst' as const
const CASE_ID = 'living-sofa-tv-v1'
const directory = resolve(process.env.LAYOUT_FIDELITY_DIR ?? 'output/layout-fidelity-v1')
const imagePath = join(directory, `${CASE_ID}--${MODEL}.webp`)
const reportPath = join(directory, `${CASE_ID}--${MODEL}.json`)
const apiKey = process.env.FAL_KEY
if (!apiKey) throw new Error('FAL_KEY required')
if (!process.argv.includes('--generate'))
  throw new Error('Pass --generate to authorize exactly one paid render')

await mkdir(directory, { recursive: true })
const cached = await readFile(reportPath, 'utf8').catch(() => null)
if (cached) {
  console.log(JSON.stringify({ caseId: CASE_ID, model: MODEL, cached: true }))
  process.exit(0)
}

const furniture = (
  id: string,
  title: string,
  category: LayoutItem['category'],
  width: number,
  depth: number,
  extra: Partial<LayoutItem> = {},
): LayoutItem => ({
  id,
  title,
  category,
  dimensions: { width, depth, height: 90 },
  quantity: 1,
  ...extra,
})

const layout = layoutRoom(
  {
    roomKind: 'living',
    widthCm: 480,
    depthCm: 560,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 150, toCm: 330, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 420, toCm: 510, clearanceCm: 90 },
    ],
  },
  [
    furniture('sofa', 'three-seat sofa', 'sofa', 240, 95, {
      operationClearance: { front: 130 },
    }),
    furniture('tv', 'low TV cabinet', 'storage', 180, 45, {
      subcategory: 'cabinet',
      operationClearance: { front: 30 },
    }),
    furniture('coffee', 'coffee table', 'table', 100, 55, {
      subcategory: 'coffee',
      operationClearance: { around: 35 },
    }),
  ],
)
if (layout.problems.length > 0 || layout.placed.length !== 3)
  throw new Error(`Synthetic layout is invalid: ${JSON.stringify(layout.problems)}`)

const style = styleLibrary[1]
if (!style) throw new Error('Missing benchmark style')
const brief: ConceptBrief = {
  roomKind: 'living',
  roomName: 'Контрольная гостиная',
  areaM2: 26.88,
  condition: 'bare',
  notes: 'Диван должен смотреть на телевизор, журнальный стол — оставаться перед диваном.',
  hasPhoto: false,
  sizeCm: { widthCm: 480, depthCm: 560, ceilingCm: 270 },
  layoutNotes:
    'На верхней стене одно окно шириной 180 см; на левой стене ближе к нижнему углу одна входная дверь шириной 90 см. Других проёмов нет.',
  layoutContract: layoutPromptContract(layout),
  budgetKopecks: 80_000_000,
  household: { adults: 2, kids: 0, pets: false, receiveGuests: true },
  primaryStyle: style,
  secondaryStyles: [],
  families: [style.family],
}
const plan = buildTemplatePlan(brief, 1)
const prompt = `${plan.shared} ${plan.variations[0]} ${plan.mandate}`.replace(/\s+/g, ' ').trim()

console.log(JSON.stringify({ caseId: CASE_ID, model: MODEL, stage: 'render', paidCap: 1 }))
const rendered = await createFalRenderer(apiKey, MODEL).render({
  prompt,
  aspectRatio: roomRenderAspectRatio(brief),
})
const image = await sharp(rendered.body).webp({ quality: 90 }).toBuffer()
await writeFile(imagePath, image)

const reviewImage = await sharp(image)
  .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()
const review = await falQueue<{ output?: string }>(apiKey, 'fal-ai/any-llm/vision', {
  model: 'anthropic/claude-sonnet-4.5',
  system_prompt:
    'Inspect only visible evidence in this interior image. Return JSON only: {"summary":"Russian text","checks":[{"id":"string","status":"confirmed|contradicted|not_visible","evidence":"Russian text"}]}. Never infer centimetres from perspective. Use contradicted only for an obvious visible conflict; otherwise use not_visible.',
  prompt: `Check these ids: room_type (living room), sofa (one three-seat sofa), tv (one low TV cabinet with television), coffee (one coffee table), sofa_tv (sofa faces the television), coffee_relation (coffee table is in front of and usable from the sofa), window (exactly one ordinary window is visible or no extra window is visible), door (one entrance door near a corner is visible), route (visible furniture does not block the entrance-to-seating route). Expected calculated plan: ${brief.layoutContract}`,
  image_url: toDataUri({ body: reviewImage, contentType: 'image/jpeg' }),
})

function parseReview(raw: unknown): unknown {
  if (typeof raw !== 'string') return { status: 'unavailable' }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return { status: 'unavailable', raw: raw.slice(0, 500) }
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return { status: 'unavailable', raw: raw.slice(0, 500) }
  }
}

const report = {
  caseId: CASE_ID,
  model: MODEL,
  createdAt: new Date().toISOString(),
  estimatedRenderUsd: conceptModels[MODEL].usdPerImage,
  paidRenderCount: 1,
  layout: layout as RoomLayout,
  layoutContract: brief.layoutContract,
  prompt,
  review: parseReview(review.output),
}
await writeFile(reportPath, JSON.stringify(report, null, 2))
console.log(
  JSON.stringify({
    caseId: CASE_ID,
    model: MODEL,
    stage: 'done',
    estimatedRenderUsd: conceptModels[MODEL].usdPerImage,
    review: report.review,
  }),
)
