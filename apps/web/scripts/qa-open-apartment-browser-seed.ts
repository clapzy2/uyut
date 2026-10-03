import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  accounts,
  catalogItems,
  createDb,
  type PlanGeometry,
  type PlanReading,
  projects,
  rooms,
  shoppingListItems,
  shoppingLists,
  users,
} from '@uyut/db'
import { hashPassword } from '../lib/password'
import { inspectPlanGeometry } from '../lib/projects/plan-geometry-inspection'

// Независимая планировка для браузерного теста. Никаких внешних запросов и платной генерации.
const connection = process.env.DATABASE_URL
if (!connection || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection).hostname)) {
  throw new Error('Этот тест разрешён только в локальной базе')
}
const appUrl = process.env.APP_URL ?? 'http://localhost:4300'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(appUrl).hostname)) {
  throw new Error('Браузерный тест разрешён только на локальном сайте')
}
const emptyShopping = process.argv.includes('--empty-shopping')

const fixtureUrl = new URL(
  '../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json',
  import.meta.url,
)
const sourceUrl = new URL('../../../jobs/fixtures/open-swiss-apartment-35063.json', import.meta.url)
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as {
  sourceSha256: string
  geometry: PlanGeometry
  rooms: PlanReading['rooms']
}
const source = JSON.parse(await readFile(sourceUrl, 'utf8')) as { rows: Array<{ row: unknown }> }
const sourceHash = createHash('sha256')
  .update(JSON.stringify(source.rows.map(({ row }) => row)))
  .digest('hex')
if (
  sourceHash !== fixture.sourceSha256 ||
  inspectPlanGeometry(fixture.geometry).some((issue) => issue.severity === 'error')
) {
  throw new Error('Независимая геометрия не прошла проверку источника и контура')
}

const db = createDb(connection)
const projectId = crypto.randomUUID()
const userId = crypto.randomUUID()
const email = `open-apartment-${userId}@example.test`
const password = 'lampa-u-okna-2026'
const now = new Date().toISOString()
const furniture = [
  {
    room: 'Спальня',
    category: 'bed' as const,
    title: 'Тестовая кровать',
    width: 160,
    depth: 200,
    height: 50,
  },
  {
    room: 'Гостиная',
    category: 'sofa' as const,
    title: 'Тестовый диван',
    width: 210,
    depth: 90,
    height: 85,
    placement: { xCm: 100, yCm: 150, rotation: 90 as const },
  },
  { room: 'Кухня', category: 'table' as const, title: 'Тестовый стол', width: 100, depth: 70 },
  {
    room: 'Кухня',
    category: 'chair' as const,
    title: 'Тестовый стул',
    width: 45,
    depth: 55,
    quantity: 2,
  },
]

const roomUrls = await db.transaction(async (tx) => {
  await tx
    .insert(users)
    .values({ id: userId, email, emailVerified: true, displayName: 'Проверка 2D' })
  await tx.insert(accounts).values({
    userId,
    accountId: userId,
    providerId: 'credential',
    password: await hashPassword(password),
  })
  await tx.insert(projects).values({
    id: projectId,
    ownerId: userId,
    title: 'Локальный тест 2D — независимая планировка',
    totalAreaM2:
      Math.round(fixture.rooms.reduce((sum, room) => sum + (room.areaM2 ?? 0), 0) * 100) / 100,
    planReading: {
      planState: 'unknown',
      rooms: fixture.rooms,
      readAt: now,
      confirmedAt: now,
      geometry: { ...fixture.geometry, status: 'confirmed', confirmedAt: now },
    },
  })

  const savedRooms = await tx
    .insert(rooms)
    .values(
      fixture.rooms.map((room, orderIndex) => ({
        projectId,
        kind: room.kind,
        spaceKind: room.name.startsWith('Балкон') ? ('balcony' as const) : ('interior' as const),
        name: room.name,
        areaM2: room.areaM2 == null ? null : Math.round(room.areaM2 * 100) / 100,
        orderIndex,
      })),
    )
    .returning({ id: rooms.id, name: rooms.name })
  const roomIds = new Map(savedRooms.map((room) => [room.name, room.id]))
  const [list] = await tx
    .insert(shoppingLists)
    .values({ projectId })
    .returning({ id: shoppingLists.id })
  if (!list) throw new Error('Не создан локальный список покупок')

  for (const item of emptyShopping ? [] : furniture) {
    const roomId = roomIds.get(item.room)
    if (!roomId) throw new Error(`Не найдена комната ${item.room}`)
    const [catalogItem] = await tx
      .insert(catalogItems)
      .values({
        source: 'dump',
        externalId: `qa-${projectId}-${item.category}`,
        category: item.category,
        title: item.title,
        priceKopecks: 100_000,
        affiliateUrl: 'https://example.test/qa-only',
        images: [],
        contentHash: `qa-${projectId}`,
        attributes: {
          dimensionsCm: { width: item.width, depth: item.depth },
          dimensionsSource: { width: 'store-parameters', depth: 'store-parameters' },
        },
      })
      .returning({ id: catalogItems.id })
    if (!catalogItem) throw new Error(`Не создан тестовый предмет ${item.title}`)
    await tx.insert(shoppingListItems).values({
      listId: list.id,
      catalogItemId: catalogItem.id,
      roomId,
      dimensionsCm: item.height ? { height: item.height } : null,
      quantity: item.quantity ?? 1,
      placementCm: item.placement ?? null,
    })
  }

  return Object.fromEntries(
    furniture.map((item) => [
      item.room,
      `${appUrl}/projects/${projectId}/rooms/${roomIds.get(item.room)}`,
    ]),
  )
})

console.log(
  JSON.stringify({
    email,
    password,
    projectId,
    projectUrl: `${appUrl}/projects/${projectId}`,
    roomUrls,
    summaryUrl: `${appUrl}/projects/${projectId}/summary`,
  }),
)
process.exit(0)
