import assert from 'node:assert/strict'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createProjectedContourBinding } from '@uyut/catalog/projected-room-layout'
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
import { eq, inArray } from 'drizzle-orm'
import { hashPassword } from '../lib/password'
import contours from './fixtures/remplanner-furnishing-contours.json'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `furnished-scene-${run}@example.test`
const password = randomUUID()
// Source-derived floor coordinates only. The calibration identity and owner are test fixtures,
// not a claim that this browser scenario recognized or confirmed the original PDF.
const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  source: 'manual',
  widthCm: 1100,
  heightCm: 1000,
  rooms: contours,
  walls: [],
  openings: [],
  warnings: [],
  pdfCalibration: {
    sourceSha256: 'a'.repeat(64),
    sourceState: 'proposed',
    pdfPage: 2,
    cmPerPoint: 1.7426031826955697,
    origin: { x: 131.881, y: 137.441 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
  },
}
const cases = [
  {
    name: 'Детская',
    sourceNumber: 4,
    kind: 'kid' as const,
    title: 'Милна - контрольный корпус',
    width: 97,
    depth: 205,
  },
  {
    name: 'Спальня',
    sourceNumber: 6,
    kind: 'bedroom' as const,
    title: 'Амьен 140 - контрольный корпус',
    width: 151,
    depth: 210,
  },
]
let db: Database | undefined
let projectId = ''
let ownerId = ''
const productIds: string[] = []
const roomIds = new Map<number, string>()

test.describe('настоящий WebGL с контрольными корпусами на контурах Remplanner', () => {
  test.setTimeout(60_000)
  test.use({
    extraHTTPHeaders: {
      origin,
      'x-forwarded-for': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`,
    },
  })
  test.beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(connection.hostname) && connection.port !== '58032',
      'Only isolated local database',
    )
    assert.equal(process.env.APP_URL, origin)
    db = createDb(connection.toString())
    const [owner] = await db
      .insert(users)
      .values({ email, emailVerified: true, displayName: 'Контроль WebGL' })
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
        title: 'Локальный QA - WebGL, не выбранная обстановка',
        planReading: {
          readAt: new Date().toISOString(),
          planState: 'proposed',
          sourcePage: 2,
          rooms: cases.map((entry) => ({
            name: entry.name,
            sourceNumber: entry.sourceNumber,
            kind: entry.kind,
          })),
          geometry,
        },
      })
      .returning()
    assert(project)
    projectId = project.id
    const [list] = await db.insert(shoppingLists).values({ projectId }).returning()
    assert(list)
    for (const entry of cases) {
      const index = geometry.rooms.findIndex((room) => room.sourceNumber === entry.sourceNumber)
      const binding = createProjectedContourBinding(geometry, index)
      assert(binding)
      const [room] = await db
        .insert(rooms)
        .values({
          projectId,
          name: `QA ${entry.name}`,
          kind: entry.kind,
          measurements: { projectedContour: binding },
        })
        .returning()
      assert(room)
      roomIds.set(entry.sourceNumber, room.id)
      for (const product of [
        {
          title: entry.title,
          category: 'bed' as const,
          width: entry.width,
          depth: entry.depth,
          height: 80,
        },
        {
          title: 'Милна 4 - контрольный шкаф',
          category: 'storage' as const,
          width: 60,
          depth: 50,
          height: 190,
        },
      ]) {
        const [saved] = await db
          .insert(catalogItems)
          .values({
            source: 'dump',
            externalId: `${run}-${entry.sourceNumber}-${product.category}`,
            title: product.title,
            category: product.category,
            priceKopecks: 0,
            affiliateUrl: 'https://example.test/qa-not-an-offer',
            images: [],
            contentHash: run,
          })
          .returning()
        assert(saved)
        productIds.push(saved.id)
        await db.insert(shoppingListItems).values({
          listId: list.id,
          roomId: room.id,
          catalogItemId: saved.id,
          quantity: 1,
          dimensionsCm: { width: product.width, depth: product.depth, height: product.height },
        })
      }
    }
  })
  test.afterAll(async () => {
    if (!db) return
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    if (productIds.length) await db.delete(catalogItems).where(inArray(catalogItems.id, productIds))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
  })

  for (const entry of cases)
    test(`${entry.name}: корпуса, камера, выбор и повторное открытие`, async ({
      page,
    }, testInfo) => {
      assert(db)
      const roomId = roomIds.get(entry.sourceNumber)
      assert(roomId)
      const before = await db.select().from(rooms).where(eq(rooms.id, roomId))
      const login = await page.request.post('/api/auth/sign-in/email', {
        headers: { origin },
        data: { email, password },
      })
      expect(login.status()).toBe(200)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`/projects/${projectId}/rooms/${roomId}`)
      const plan = page.locator('#room-plan')
      const floor = plan.locator('polygon.fill-muted')
      const source = geometry.rooms.find((room) => room.sourceNumber === entry.sourceNumber)
      assert(source)
      expect((await floor.getAttribute('points'))?.trim().split(/\s+/)).toHaveLength(
        source.polygon.length,
      )
      await plan.getByRole('button', { name: 'Посмотреть мебель в объёме', exact: true }).click()
      await plan.getByRole('button', { name: '3D-сцена', exact: true }).click()
      const canvas = plan.locator('canvas[data-scene-ready="true"]')
      await expect(canvas).toBeVisible()
      const furniture = plan.getByRole('list', { name: 'Мебель в 3D-сцене' })
      await expect(furniture.getByRole('button')).toHaveCount(2)
      const initial = await canvas.screenshot({ path: testInfo.outputPath('scene-initial.png') })
      const controls = plan.getByRole('group', { name: 'Управление 3D-сценой' })
      await controls.getByRole('button', { name: 'Вправо ↷', exact: true }).click()
      const rotated = await canvas.screenshot({ path: testInfo.outputPath('scene-rotated.png') })
      expect(createHash('sha256').update(rotated).digest('hex')).not.toBe(
        createHash('sha256').update(initial).digest('hex'),
      )
      const bed = furniture.getByRole('button', { name: new RegExp(entry.title) })
      await bed.click()
      await expect(bed).toHaveAttribute('aria-pressed', 'true')
      await expect(plan.getByText(`Выбран предмет: ${entry.title}`, { exact: true })).toBeVisible()
      await expect(plan.getByText(/Габарит на схеме:.*Высота 80 см/)).toBeVisible()
      await expect(
        plan.getByText(
          new RegExp(
            `Габарит на схеме: (?:${entry.width} × ${entry.depth}|${entry.depth} × ${entry.width}) см`,
          ),
        ),
      ).toBeVisible()
      await controls
        .getByRole('button', { name: 'Показать выбранное крупнее', exact: true })
        .click()
      await plan.getByRole('button', { name: 'Снять выделение', exact: true }).click()
      const box = await canvas.boundingBox()
      assert(box)
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })
      await expect(bed).toHaveAttribute('aria-pressed', 'true')
      const cabinet = furniture.getByRole('button', { name: /Милна 4/ })
      await cabinet.click()
      await expect(plan.getByText(/Габарит на схеме:.*Высота 190 см/)).toBeVisible()
      await expect(plan.getByText(/Габарит на схеме: (?:60 × 50|50 × 60) см/)).toBeVisible()
      await controls
        .getByRole('button', { name: 'Показать выбранное крупнее', exact: true })
        .click()
      await canvas.screenshot({ path: testInfo.outputPath('scene-cabinet.png') })
      await controls.getByRole('button', { name: 'Исходный вид', exact: true }).click()
      await controls.getByRole('button', { name: 'Сверху', exact: true }).click()
      await canvas.screenshot({ path: testInfo.outputPath('scene-top.png') })
      await controls.getByRole('button', { name: 'Исходный вид', exact: true }).click()
      await expect(cabinet).toHaveAttribute('aria-pressed', 'false')
      await page.setViewportSize({ width: 390, height: 844 })
      await canvas.screenshot({ path: testInfo.outputPath('scene-mobile.png') })
      await expect(canvas).toBeVisible()
      await page.reload()
      await expect(floor).toBeVisible()
      expect(await db.select().from(rooms).where(eq(rooms.id, roomId))).toEqual(before)
      const items = await db
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.roomId, roomId))
      expect(items).toHaveLength(2)
      expect(
        items.every((item) => item.operationClearanceCm === null && item.placementCm === null),
      ).toBe(true)
      expect(errors).toEqual([])
    })
})
