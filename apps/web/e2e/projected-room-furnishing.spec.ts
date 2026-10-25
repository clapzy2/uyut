import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  accounts,
  catalogItems,
  createDb,
  type Database,
  type PlanGeometry,
  projects,
  rooms,
  shoppingListItems,
  shoppingLists,
  users,
} from '@uyut/db'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../lib/password'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `projected-furnishing-${run}@example.test`
const password = `projected-${randomUUID()}`
const title = 'Синтетический диван для проверки проектной расстановки'
const sourceSha256 = 'a'.repeat(64)
const measurements = { widthCm: 320, depthCm: 600 }
const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  source: 'manual',
  widthCm: 1000,
  heightCm: 500,
  walls: [],
  openings: [],
  warnings: [],
  rooms: [
    {
      name: 'Проектная открытая группа',
      sourceNumbers: [1, 2, 3],
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 600, yCm: 0 },
        { xCm: 600, yCm: 200 },
        { xCm: 300, yCm: 200 },
        { xCm: 300, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
    {
      name: 'Проектная спальня',
      sourceNumber: 4,
      polygon: [
        { xCm: 650, yCm: 0 },
        { xCm: 950, yCm: 0 },
        { xCm: 950, yCm: 350 },
        { xCm: 650, yCm: 350 },
      ],
    },
  ],
  pdfCalibration: {
    sourceSha256,
    pdfPage: 1,
    sourceState: 'proposed',
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
  },
}
let db: Database | undefined
let ownerId = ''
let projectId = ''
let roomId = ''
let secondRoomId = ''
let productId = ''
let itemId = ''

async function savedRoom(id: string) {
  assert(db)
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id))
  assert(room)
  return room
}

// The synthetic native-PDF calibration is seeded, not recognized or fetched from a real plan.
test.describe('проектная мебельная схема по синтетическому Г-контуру', () => {
  test.setTimeout(60_000)
  test.use({
    actionTimeout: 15_000,
    extraHTTPHeaders: {
      origin,
      'x-forwarded-for': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`,
    },
  })

  test.beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(connection.hostname) && connection.port !== '58032',
      'Только изолированная локальная БД, не production-туннель',
    )
    assert.equal(process.env.APP_URL, origin)
    db = createDb(connection.toString())
    const [owner] = await db
      .insert(users)
      .values({
        email,
        emailVerified: true,
        displayName: 'Синтетическая проектная мебель',
      })
      .returning()
    assert(owner)
    ownerId = owner.id
    await db.insert(accounts).values({
      userId: ownerId,
      accountId: ownerId,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    const [project] = await db
      .insert(projects)
      .values({
        ownerId,
        title: `Синтетическая проверка проектного контура ${run}`,
        planReading: {
          readAt: new Date().toISOString(),
          planState: 'proposed',
          sourcePage: 1,
          rooms: [
            { name: 'Проектная открытая группа', sourceNumber: 1, kind: 'living' },
            { name: 'Проектная кухня', sourceNumber: 2, kind: 'kitchen' },
            { name: 'Проектная прихожая', sourceNumber: 3, kind: 'living' },
            { name: 'Проектная спальня', sourceNumber: 4, kind: 'bedroom' },
          ],
          geometry,
        },
      })
      .returning()
    assert(project)
    projectId = project.id
    const [room] = await db
      .insert(rooms)
      .values({
        projectId,
        kind: 'living',
        name: 'Старая комната',
        measurements,
      })
      .returning()
    assert(room)
    roomId = room.id
    const [second] = await db
      .insert(rooms)
      .values({
        projectId,
        kind: 'bedroom',
        name: 'Вторая комната',
        measurements,
      })
      .returning()
    assert(second)
    secondRoomId = second.id
    const [product] = await db
      .insert(catalogItems)
      .values({
        source: 'dump',
        externalId: run,
        category: 'sofa',
        title,
        contentHash: run,
        priceKopecks: 10000,
        affiliateUrl: 'https://example.test/projected-sofa',
        images: [],
        inStock: true,
      })
      .returning()
    assert(product)
    productId = product.id
    const [list] = await db.insert(shoppingLists).values({ projectId }).returning()
    assert(list)
    const [shoppingItem] = await db
      .insert(shoppingListItems)
      .values({
        listId: list.id,
        catalogItemId: productId,
        roomId,
        quantity: 1,
        dimensionsCm: { width: 50, depth: 40, height: 80 },
        operationClearanceCm: { front: 70 },
        placementCm: { xCm: 50, yCm: 50, rotation: 0, frontDirection: 'right' },
      })
      .returning()
    assert(shoppingItem)
    itemId = shoppingItem.id
  })

  test.afterAll(async () => {
    if (!db) return
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    if (productId) await db.delete(catalogItems).where(eq(catalogItems.id, productId))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
  })

  test('явно связывает группу, сохраняет Г-контур и удерживает устаревшую связь без прямоугольного fallback', async ({
    page,
  }) => {
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}/rooms/${roomId}`)
    const plan = page.locator('#room-plan')
    const drawing = plan.getByRole('img', { name: /План комнаты/ })
    await expect(drawing).toHaveAttribute('aria-label', /320 на 600/)
    await expect(drawing.locator('polygon.fill-muted')).toHaveCount(0)

    const selection = page.getByLabel('Проектная область для расстановки', { exact: true })
    await selection.selectOption('0')
    await page
      .getByLabel('Понимаю, что это проектная расстановка, а не подтверждённый обмер', {
        exact: true,
      })
      .check()
    await page.getByRole('button', { name: 'Связать с проектным контуром', exact: true }).click()
    await expect
      .poll(async () => (await savedRoom(roomId)).measurements)
      .toMatchObject({
        ...measurements,
        projectedContour: {
          version: 1,
          geometryKey: expect.any(String),
          sourceSha256,
          pdfPage: 1,
          roomIndex: 0,
          sourceNumbers: [1, 2, 3],
        },
      })
    const bindingSnapshot = (await savedRoom(roomId)).measurements
    await expect(drawing).toHaveAttribute('aria-label', /600 на 400/)
    const floor = drawing.locator('polygon.fill-muted')
    await expect(floor).toHaveCount(1)
    const points = await floor.getAttribute('points')
    assert(points)
    expect(points?.trim().split(/\s+/)).toHaveLength(6)
    await expect(
      plan.getByRole('button', { name: `Переместить: ${title}`, exact: true }),
    ).toHaveCount(1)
    expect(
      await drawing.evaluate((svg) => {
        const contour = svg.querySelector<SVGGeometryElement>('polygon.fill-muted')
        const item = svg.querySelector<SVGGraphicsElement>('rect[stroke-width="1.5"]')
        if (!contour || !item) return false
        const box = item.getBBox()
        return [box.x, box.x + box.width].every((x) =>
          [box.y, box.y + box.height].every((y) => contour.isPointInFill(new DOMPoint(x, y))),
        )
      }),
    ).toBe(true)
    await page.reload()
    await expect(floor).toHaveAttribute('points', points)
    expect((await savedRoom(roomId)).measurements).toEqual(bindingSnapshot)

    const placement = plan.locator('details').filter({ hasText: 'Точное положение мебели' })
    await placement.locator('summary').click()
    await placement.getByLabel(`Отступ слева, см: ${title}`, { exact: true }).fill('50')
    await placement.getByLabel(`Отступ сверху, см: ${title}`, { exact: true }).fill('50')
    await expect(page.getByText('Страница не открылась.', { exact: true })).toHaveCount(0)
    await expect(placement.getByLabel(`Поворот: ${title}`, { exact: true })).toBeVisible()
    await placement.getByLabel(`Поворот: ${title}`, { exact: true }).selectOption('0')
    await placement.getByLabel(`Рабочая сторона: ${title}`, { exact: true }).selectOption('right')
    await placement.getByRole('button', { name: 'Закрепить', exact: true }).click()
    await expect
      .poll(async () => {
        assert(db)
        const [item] = await db
          .select()
          .from(shoppingListItems)
          .where(eq(shoppingListItems.id, itemId))
        return item?.placementCm
      })
      .toEqual({ xCm: 50, yCm: 50, rotation: 0, frontDirection: 'right' })
    await page.reload()
    await expect(floor).toHaveAttribute('points', points)
    expect((await savedRoom(roomId)).measurements).toEqual(bindingSnapshot)
    await placement.locator('summary').click()
    await expect(placement.getByLabel(`Отступ слева, см: ${title}`, { exact: true })).toHaveValue(
      '50',
    )
    await expect(placement.getByLabel(`Отступ сверху, см: ${title}`, { exact: true })).toHaveValue(
      '50',
    )
    await expect(placement.getByRole('button', { name: 'Обновить', exact: true })).toBeVisible()

    await page.goto(`/projects/${projectId}/rooms/${secondRoomId}`)
    const secondSelect = page.getByLabel('Проектная область для расстановки', { exact: true })
    await secondSelect.selectOption('0')
    await page
      .getByLabel('Понимаю, что это проектная расстановка, а не подтверждённый обмер', {
        exact: true,
      })
      .check()
    await page.getByRole('button', { name: 'Связать с проектным контуром', exact: true }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Эта область уже связана с комнатой «Старая комната».' }),
    ).toBeVisible()
    expect((await savedRoom(secondRoomId)).measurements).toEqual(measurements)

    // Only this test's isolated project changes; its old binding must not fit a new polygon.
    assert(db)
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
    assert(project?.planReading?.geometry)
    const changed = structuredClone(project.planReading)
    assert(changed.geometry?.rooms[0]?.polygon[2])
    changed.geometry.rooms[0].polygon[2].xCm = 580
    await db.update(projects).set({ planReading: changed }).where(eq(projects.id, projectId))
    await page.goto(`/projects/${projectId}/rooms/${roomId}`)
    await expect(page.locator('#room-plan')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: `Переместить: ${title}`, exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'Связь с проектным контуром устарела.' }),
    ).toBeVisible()
    expect((await savedRoom(roomId)).measurements).toEqual(bindingSnapshot)
  })
})
