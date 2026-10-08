import assert from 'node:assert/strict'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { type APIRequestContext, expect, type Locator, test } from '@playwright/test'
import { accounts, createDb, type Database, type PlanGeometry, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { realisticBalconyApartment } from '../../../jobs/fixtures/realistic-balcony-apartment'
import { hashPassword } from '../lib/password'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `contour-${run}@example.test`
const password = `contour-${randomUUID()}`
const planUrl = `synthetic-contour-${run}.png`
const geometry: PlanGeometry = {
  ...realisticBalconyApartment.geometry,
  status: 'draft',
  confirmedAt: undefined,
  kitchenItems: [],
  imageCalibration: {
    imageWidthPx: 820,
    imageHeightPx: 970,
    pixelStart: { x: 110, y: 110 },
    pixelEnd: { x: 710, y: 110 },
    worldStart: { xCm: 40, yCm: 40 },
    lengthCm: 600,
    direction: 'right',
    verificationLines: [
      { pixelStart: { x: 110, y: 110 }, pixelEnd: { x: 110, y: 710 }, lengthCm: 600 },
    ],
  },
  rooms: realisticBalconyApartment.geometry.rooms.map((room) =>
    room.spaceKind === 'balcony'
      ? {
          ...room,
          polygon: [
            { xCm: 390, yCm: 670 },
            { xCm: 640, yCm: 670 },
            { xCm: 640, yCm: 790 },
            { xCm: 390, yCm: 790 },
          ],
        }
      : room,
  ),
}
let database: Database | undefined
let storage: S3Client | undefined
let ownerId = ''
let projectId = ''

async function signIn(request: APIRequestContext) {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email, password },
  })
  expect(response.status()).toBe(200)
}

async function savedGeometry() {
  assert(database)
  const [project] = await database.select().from(projects).where(eq(projects.id, projectId))
  return project?.planReading?.geometry
}

async function addNumericVertex(trace: Locator, index: number, x: number, y: number) {
  await trace.getByRole('button', { name: 'Добавить угол числом', exact: true }).click()
  await trace.getByLabel(`Угол ${index} · X, пикс.`, { exact: true }).fill(String(x))
  await trace.getByLabel(`Угол ${index} · Y, пикс.`, { exact: true }).fill(String(y))
}

// Only synthetic local data. The source is uploaded to isolated storage so pixel guides
// use the actual server decoder. No image recognition, generation or paid jobs are requested.
test.describe('обводка растрового контура по двум проверенным направлениям', () => {
  test.use({
    extraHTTPHeaders: {
      origin,
      'x-forwarded-for': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`,
    },
  })

  test.beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(connection.hostname) &&
        connection.port === '5432' &&
        connection.pathname === '/uyut',
      'Нужна изолированная локальная БД localhost:5432/uyut, не production-туннель',
    )
    assert(process.env.APP_URL === origin)
    const endpoint = new URL(process.env.S3_ENDPOINT ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(endpoint.hostname) && endpoint.port === '9000',
      'Нужен изолированный локальный S3 на порту 9000',
    )
    storage = new S3Client({
      endpoint: endpoint.toString(),
      region: process.env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY as string,
        secretAccessKey: process.env.S3_SECRET_KEY as string,
      },
    })
    database = createDb(connection.toString())
    const [owner] = await database
      .insert(users)
      .values({ email, emailVerified: true, displayName: 'Синтетическая обводка' })
      .returning()
    assert(owner)
    ownerId = owner.id
    await database.insert(accounts).values({
      userId: ownerId,
      accountId: ownerId,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    const [project] = await database
      .insert(projects)
      .values({
        ownerId,
        title: `Синтетическая обводка, не обмер ${run}`,
        planUrl,
        planReading: { ...realisticBalconyApartment.reading, geometry },
      })
      .returning()
    assert(project)
    projectId = project.id
  })

  test.afterAll(async () => {
    if (database && projectId) await database.delete(projects).where(eq(projects.id, projectId))
    if (database && ownerId) await database.delete(users).where(eq(users.id, ownerId))
    if (storage) {
      await storage.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: planUrl }))
      storage.destroy()
    }
  })

  test('отмена сохраняет пол, пять углов балкона переживают сохранение и перезагрузку', async ({
    page,
  }) => {
    const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="970"><rect width="820" height="970" fill="white"/><path d="M110 110H710V710H590V740H710V810L660 860H460V740H510V710H110Z M460 740H710V810L660 860H460Z" fill="none" stroke="black" stroke-width="3"/><text x="160" y="90">SYNTHETIC TEST ONLY · 600 cm</text></svg>`
    const sourcePng = await sharp(Buffer.from(sourceSvg)).png().toBuffer()
    assert(storage)
    await storage.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: planUrl,
        Body: sourcePng,
        ContentType: 'image/png',
      }),
    )
    await page.route(`**/${planUrl}*`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: sourcePng }),
    )
    await signIn(page.request)
    await page.goto(`/projects/${projectId}`)
    await page.getByRole('button', { name: 'Проверить схему', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Проверка 2D-схемы', exact: true })
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption('floor:boundary')
    const floorTrace = dialog.locator('details').filter({
      has: page.locator('summary', { hasText: 'Обвести на исходнике · Общая граница пола' }),
    })
    await floorTrace.locator('summary').click()
    await floorTrace.getByRole('button', { name: 'Начать новую обводку', exact: true }).click()
    await addNumericVertex(floorTrace, 1, 110, 110)
    const guidesResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/projects/${projectId}/plan-raster-edges`),
    )
    await floorTrace.getByRole('button', { name: 'Найти углы по пикселям', exact: true }).click()
    const response = await guidesResponse
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    const guides = (await response.json()) as {
      source: { sha256: string; page: number; width: number; height: number }
      points: { x: number; y: number }[]
      truncated: boolean
      uncertain: boolean
    }
    expect(guides.source).toEqual({
      sha256: createHash('sha256').update(sourcePng).digest('hex'),
      page: 1,
      width: 820,
      height: 970,
    })
    expect(guides.truncated).toBe(false)
    expect(guides.uncertain).toBe(false)
    const assistance = floorTrace.getByRole('checkbox', {
      name: 'Помогать привязкой новых углов к изображению',
      exact: true,
    })
    await expect(assistance).not.toBeChecked()
    await expect(floorTrace.getByLabel('Угол 1 · X, пикс.', { exact: true })).toHaveValue('110')
    await assistance.check()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await floorTrace.scrollIntoViewIfNeeded()
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true)
      await floorTrace.screenshot({
        path: resolve(`../../output/playwright/raster-corner-guides-${viewport.width}.png`),
      })
    }
    await expect(floorTrace.getByLabel('Угол 1 · Y, пикс.', { exact: true })).toHaveValue('110')
    const floorImage = floorTrace.getByRole('img', {
      name: 'Исходник для обводки: Общая граница пола',
      exact: true,
    })
    await floorImage.scrollIntoViewIfNeeded()
    const floorBox = await floorImage.boundingBox()
    assert(floorBox)
    // Browser mouse events use integer CSS coordinates. Select a genuine candidate whose
    // nearest neighbour remains unambiguous after that rounding, not a fabricated wall corner.
    const click = guides.points
      .map((candidate) => {
        const clientX = Math.round(floorBox.x + (candidate.x * floorBox.width) / 820)
        const clientY = Math.round(floorBox.y + (candidate.y * floorBox.height) / 970)
        const pointer = {
          x: ((clientX - floorBox.x) * 820) / floorBox.width,
          y: ((clientY - floorBox.y) * 970) / floorBox.height,
        }
        const nearest = guides.points
          .map((point) => ({
            point,
            distance: Math.hypot(point.x - pointer.x, point.y - pointer.y),
          }))
          .sort((first, second) => first.distance - second.distance)
        const first = nearest[0]
        const second = nearest[1]
        return first && first.distance <= 8 && (!second || second.distance - first.distance >= 2.5)
          ? { clientX, clientY, point: first.point }
          : undefined
      })
      .find((candidate) => candidate !== undefined)
    assert(click, 'Синтетический растр должен дать хотя бы одну однозначную подсказку')
    await page.mouse.click(click.clientX, click.clientY)
    await expect(floorTrace.getByLabel('Угол 2 · X, пикс.', { exact: true })).toHaveValue(
      String(click.point.x),
    )
    await expect(floorTrace.getByLabel('Угол 2 · Y, пикс.', { exact: true })).toHaveValue(
      String(click.point.y),
    )
    expect(await savedGeometry()).toEqual(geometry)
    await assistance.uncheck()
    await expect(floorTrace.getByLabel('Угол 2 · X, пикс.', { exact: true })).toHaveValue(
      String(click.point.x),
    )
    await floorTrace.getByRole('button', { name: 'Отменить обводку', exact: true }).click()
    expect(await savedGeometry()).toEqual(geometry)
    await expect(dialog.locator('#floor-point-0-xCm')).toHaveValue('40')
    await expect(dialog.locator('[id^="floor-point-"]')).toHaveCount(26)

    const guideRoute = '**/plan-raster-edges?*'
    await page.route(guideRoute, (route) => route.fulfill({ status: 422, body: 'Unavailable' }))
    await floorTrace.getByRole('button', { name: 'Найти углы по пикселям', exact: true }).click()
    await expect(floorTrace.getByRole('status')).toHaveText(
      'Подсказки не загрузились. Обводка вручную остаётся доступной.',
    )
    await expect(assistance).toHaveCount(0)
    expect(await savedGeometry()).toEqual(geometry)
    await page.unroute(guideRoute)

    await floorTrace.getByRole('button', { name: 'Начать новую обводку', exact: true }).click()
    assert(geometry.footprint)
    for (const [index, point] of geometry.footprint.entries()) {
      await addNumericVertex(floorTrace, index + 1, point.xCm + 70, point.yCm + 70)
    }
    await floorTrace
      .getByRole('button', { name: 'Применить обводку в черновик', exact: true })
      .click()
    await floorTrace.screenshot({
      path: resolve('../../output/playwright/contour-floor-overlay.png'),
    })

    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption('room:4')
    const balconyTrace = dialog.locator('details').filter({
      has: page.locator('summary', { hasText: 'Обвести на исходнике · Балкон' }),
    })
    await balconyTrace.locator('summary').click()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await balconyTrace.scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true)
      await balconyTrace.screenshot({
        path: resolve(`../../output/playwright/contour-source-${viewport.width}.png`),
      })
    }

    await balconyTrace.getByRole('button', { name: 'Начать новую обводку', exact: true }).click()
    const image = balconyTrace.getByRole('img', { name: 'Исходник для обводки: Балкон' })
    await image.scrollIntoViewIfNeeded()
    const box = await image.boundingBox()
    assert(box)
    await page.mouse.click(box.x + (460 * box.width) / 820, box.y + (740 * box.height) / 970)
    await expect(balconyTrace.getByLabel('Угол 1 · X, пикс.', { exact: true })).toBeVisible()
    // Fractional CSS pixels need not land exactly on a centimetre; numeric fallback corrects it.
    await balconyTrace.getByLabel('Угол 1 · X, пикс.', { exact: true }).fill('460')
    await balconyTrace.getByLabel('Угол 1 · Y, пикс.', { exact: true }).fill('740')
    await addNumericVertex(balconyTrace, 2, 710, 740)
    await addNumericVertex(balconyTrace, 3, 710, 810)
    await addNumericVertex(balconyTrace, 4, 660, 860)
    await addNumericVertex(balconyTrace, 5, 460, 860)
    await balconyTrace.locator('div.relative.inline-block').screenshot({
      path: resolve('../../output/playwright/contour-balcony-five-points.png'),
    })
    await balconyTrace
      .getByRole('button', { name: 'Применить обводку в черновик', exact: true })
      .click()
    expect((await savedGeometry())?.rooms[4]?.polygon).toHaveLength(4)
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    const expected = realisticBalconyApartment.geometry.rooms[4]?.polygon
    await expect.poll(async () => (await savedGeometry())?.rooms[4]?.polygon).toEqual(expected)
    expect((await savedGeometry())?.footprint).toEqual(geometry.footprint)
    expect((await savedGeometry())?.status).toBe('draft')
    await page.reload()
    await page.getByRole('button', { name: 'Проверить схему', exact: true }).click()
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption('room:4')
    await expect(dialog.getByText('5 из 30 точек', { exact: true })).toBeVisible()
    expect((await savedGeometry())?.rooms[4]?.polygon).toEqual(expected)
  })
})
