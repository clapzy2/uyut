/** Paid layout-fidelity suite. Synthetic data only, no retries, uploads or customer data. */
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
import {
  type LayoutItem,
  type LayoutRoomKind,
  layoutPromptContract,
  layoutRoom,
  type RoomLayout,
  type WallReservation,
} from '@uyut/catalog'
import sharp from 'sharp'

const MODEL = 'gpt-image-2.5-sunburst' as const
const MAX_NEW_RENDERS = 3
const directory = resolve(process.env.LAYOUT_FIDELITY_DIR ?? 'output/layout-fidelity-v1')

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

type CaseSpec = {
  id: string
  kind: LayoutRoomKind
  roomName: string
  widthCm: number
  depthCm: number
  reservations: WallReservation[]
  layoutNotes: string
  notes: string
  items: LayoutItem[]
  household: ConceptBrief['household']
  checks: string
}

const cases: CaseSpec[] = [
  {
    id: 'living-sofa-tv-v1',
    kind: 'living',
    roomName: 'Контрольная гостиная',
    widthCm: 480,
    depthCm: 560,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 150, toCm: 330, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 420, toCm: 510, clearanceCm: 90 },
    ],
    layoutNotes:
      'На верхней стене одно окно шириной 180 см; на левой стене ближе к нижнему углу одна входная дверь шириной 90 см. Других проёмов нет.',
    notes: 'Диван должен смотреть на телевизор, журнальный стол — оставаться перед диваном.',
    items: [
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
    household: { adults: 2, kids: 0, pets: false, receiveGuests: true },
    checks:
      'room_type (living room), sofa (one three-seat sofa), tv (one low TV cabinet with television), coffee (one coffee table), sofa_tv (sofa faces the television), coffee_relation (coffee table is in front of and usable from the sofa), window (exactly one ordinary window is visible or no extra window is visible), door (one entrance door near a corner is visible), route (visible furniture does not block the entrance-to-seating route)',
  },
  {
    id: 'bedroom-storage-v1',
    kind: 'bedroom',
    roomName: 'Контрольная спальня',
    widthCm: 420,
    depthCm: 480,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 120, toCm: 300, clearanceCm: 0 },
      { kind: 'door', wall: 'bottom', fromCm: 20, toCm: 110, clearanceCm: 90 },
    ],
    layoutNotes:
      'На верхней стене одно окно шириной 180 см; на нижней стене у левого угла одна дверь шириной 90 см. Других проёмов нет.',
    notes:
      'Нужны двуспальная кровать, шкаф и комод; окно и проход от двери должны остаться свободными.',
    items: [
      furniture('bed', 'double bed', 'bed', 160, 200, {
        operationClearance: { side: 45 },
      }),
      furniture('wardrobe', 'wardrobe', 'storage', 180, 60, {
        subcategory: 'wardrobe',
        operationClearance: { front: 55 },
      }),
      furniture('dresser', 'chest of drawers', 'storage', 100, 45, {
        subcategory: 'dresser',
        operationClearance: { front: 45 },
      }),
    ],
    household: { adults: 2, kids: 0, pets: false },
    checks:
      'room_type (bedroom), bed (one double bed), wardrobe (one full-height wardrobe), dresser (one chest of drawers), window (exactly one ordinary window is visible or no extra window is visible), door (one entrance door near a corner is visible), window_clear (no tall furniture blocks the window), operations (visible wardrobe and drawers can open), route (visible furniture does not block the route from entrance to bed)',
  },
  {
    id: 'kid-study-v1',
    kind: 'kid',
    roomName: 'Контрольная детская',
    widthCm: 400,
    depthCm: 480,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 120, toCm: 240, clearanceCm: 0, sillHeightCm: 90 },
      { kind: 'door', wall: 'left', fromCm: 380, toCm: 470, clearanceCm: 90 },
    ],
    layoutNotes:
      'На верхней стене одно окно шириной 120 см с подоконником 90 см; на левой стене у нижнего угла одна дверь шириной 90 см. Других проёмов нет.',
    notes:
      'Нужны односпальная кровать, письменный стол и шкаф, а в центре — свободное место для игры.',
    items: [
      furniture('bed', 'single bed', 'bed', 90, 200, {
        operationClearance: { side: 40 },
      }),
      furniture('desk', 'study desk', 'table', 120, 60, {
        subcategory: 'desk',
        operationClearance: { front: 80 },
      }),
      furniture('wardrobe', 'child wardrobe', 'storage', 100, 55, {
        subcategory: 'wardrobe',
        operationClearance: { front: 45 },
      }),
    ],
    household: { adults: 2, kids: 1, pets: false },
    checks:
      'room_type (child room), bed (one single bed), desk (one usable study desk), wardrobe (one child wardrobe), play (a visible open play area remains), window (exactly one ordinary window is visible or no extra window is visible), door (one entrance door near a corner is visible), window_clear (tall storage does not block the window), operations (desk chair and wardrobe can be used), route (visible furniture does not block the entrance route)',
  },
  {
    id: 'compact-kitchen-v1',
    kind: 'kitchen',
    roomName: 'Контрольная кухня',
    widthCm: 360,
    depthCm: 420,
    reservations: [
      { kind: 'window', wall: 'top', fromCm: 120, toCm: 240, clearanceCm: 0, sillHeightCm: 90 },
      { kind: 'door', wall: 'bottom', fromCm: 0, toCm: 90, clearanceCm: 90 },
    ],
    layoutNotes:
      'На верхней стене одно окно шириной 120 см с подоконником 90 см; на нижней стене у левого угла одна дверь шириной 90 см. Других проёмов нет.',
    notes:
      'Компактная кухня без острова: рабочая линия, холодильник и небольшой обеденный стол на двоих.',
    items: [
      furniture('run', 'base cabinet run with sink and hob', 'storage', 180, 60, {
        subcategory: 'cabinet',
        operationClearance: { front: 80 },
      }),
      furniture('fridge', 'refrigerator', 'storage', 60, 65, {
        subcategory: 'wardrobe',
        operationClearance: { front: 75 },
      }),
      furniture('table', 'small dining table for two', 'table', 80, 50, {
        subcategory: 'dining',
        operationClearance: { around: 55 },
      }),
    ],
    household: { adults: 2, kids: 0, pets: false, cookHome: true },
    checks:
      'room_type (compact kitchen), cabinet_run (one continuous base cabinet run with visible sink and hob), fridge (one refrigerator), table (one small dining table with exactly two usable seats), no_island (there is no island), window (exactly one ordinary window is visible or no extra window is visible), door (one entrance door near a corner is visible), operations (refrigerator and lower cabinets can visibly open), route (visible furniture does not block the entrance-to-worktop route)',
  },
]

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

await mkdir(directory, { recursive: true })
const prepared = await Promise.all(
  cases.map(async (testCase) => {
    const layout = layoutRoom(
      {
        roomKind: testCase.kind,
        widthCm: testCase.widthCm,
        depthCm: testCase.depthCm,
        reservations: testCase.reservations,
      },
      testCase.items,
    )
    if (layout.problems.length > 0 || layout.placed.length !== testCase.items.length) {
      throw new Error(
        `${testCase.id} layout is invalid: ${JSON.stringify({ problems: layout.problems, placed: layout.placed.length })}`,
      )
    }
    const reportPath = join(directory, `${testCase.id}--${MODEL}.json`)
    const cached = await readFile(reportPath, 'utf8').catch(() => null)
    return { testCase, layout, reportPath, cached }
  }),
)

const pending = prepared.filter((item) => !item.cached)
if (process.argv.includes('--validate-only')) {
  console.log(
    JSON.stringify({
      cases: prepared.map((item) => ({
        id: item.testCase.id,
        placed: item.layout.placed.length,
        walkwayCm: item.layout.walkwayCm,
        cached: Boolean(item.cached),
      })),
      pending: pending.length,
    }),
  )
  process.exit(0)
}
if (!process.argv.includes('--generate'))
  throw new Error('Pass --generate to authorize the capped paid render suite')
if (pending.length > MAX_NEW_RENDERS)
  throw new Error(`Paid image cap exceeded: ${pending.length} > ${MAX_NEW_RENDERS}`)
const apiKey = process.env.FAL_KEY
if (!apiKey) throw new Error('FAL_KEY required')
const style = styleLibrary[1]
if (!style) throw new Error('Missing benchmark style')

for (const item of prepared) {
  const { testCase, layout, reportPath, cached } = item
  if (cached) {
    console.log(JSON.stringify({ caseId: testCase.id, model: MODEL, cached: true }))
    continue
  }
  const brief: ConceptBrief = {
    roomKind: testCase.kind,
    roomName: testCase.roomName,
    areaM2: (testCase.widthCm * testCase.depthCm) / 10_000,
    condition: 'bare',
    notes: testCase.notes,
    hasPhoto: false,
    sizeCm: { widthCm: testCase.widthCm, depthCm: testCase.depthCm, ceilingCm: 270 },
    layoutNotes: testCase.layoutNotes,
    layoutContract: layoutPromptContract(layout),
    budgetKopecks: 80_000_000,
    household: testCase.household,
    primaryStyle: style,
    secondaryStyles: [],
    families: [style.family],
  }
  const plan = buildTemplatePlan(brief, 1)
  const prompt = `${plan.shared} ${plan.variations[0]} ${plan.mandate}`.replace(/\s+/g, ' ').trim()
  console.log(
    JSON.stringify({ caseId: testCase.id, model: MODEL, stage: 'render', paidCap: pending.length }),
  )
  const rendered = await createFalRenderer(apiKey, MODEL).render({
    prompt,
    aspectRatio: roomRenderAspectRatio(brief),
  })
  const image = await sharp(rendered.body).webp({ quality: 90 }).toBuffer()
  const imagePath = join(directory, `${testCase.id}--${MODEL}.webp`)
  await writeFile(imagePath, image)
  const reviewImage = await sharp(image)
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  const review = await falQueue<{ output?: string }>(apiKey, 'fal-ai/any-llm/vision', {
    model: 'anthropic/claude-sonnet-4.5',
    system_prompt:
      'Inspect only visible evidence in this interior image. Return JSON only: {"summary":"Russian text","checks":[{"id":"string","status":"confirmed|contradicted|not_visible","evidence":"Russian text"}]}. Never infer centimetres from perspective. Confirm an object only when its type is unmistakable: a low cabinet, dresser or cropped foreground surface does not confirm a full-height wardrobe. Use contradicted only for an obvious visible conflict; otherwise use not_visible.',
    prompt: `Check these ids: ${testCase.checks}. Expected calculated plan: ${brief.layoutContract}`,
    image_url: toDataUri({ body: reviewImage, contentType: 'image/jpeg' }),
  })
  const report = {
    caseId: testCase.id,
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
      caseId: testCase.id,
      model: MODEL,
      stage: 'done',
      estimatedRenderUsd: conceptModels[MODEL].usdPerImage,
      review: report.review,
    }),
  )
}
