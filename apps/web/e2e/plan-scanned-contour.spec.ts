import assert from 'node:assert/strict'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, type Locator, test } from '@playwright/test'
import { accounts, createDb, type Database, type PlanGeometry, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { realisticBalconyApartment } from '../../../jobs/fixtures/realistic-balcony-apartment'
import { hashPassword } from '../lib/password'
import { planEditRevision } from '../lib/projects/plan-edit-revision'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `scan-contour-${run}@example.test`
const password = `scan-${randomUUID()}`
const planUrl = `synthetic-scanned-contour-${run}.pdf`
const geometry: PlanGeometry = {
  ...realisticBalconyApartment.geometry,
  status: 'draft',
  confirmedAt: undefined,
  imageCalibration: undefined,
  kitchenItems: [],
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
let sourceSha256 = ''

async function savedProject() {
  assert(database)
  const [project] = await database.select().from(projects).where(eq(projects.id, projectId))
  assert(project)
  return project
}

async function addVertex(trace: Locator, index: number, x: number, y: number) {
  await trace.getByRole('button', { name: 'Добавить угол числом', exact: true }).click()
  await trace.getByLabel(`Угол ${index} · X, пикс.`, { exact: true }).fill(String(x))
  await trace.getByLabel(`Угол ${index} · Y, пикс.`, { exact: true }).fill(String(y))
}

// An actual image-only PDF in isolated storage. No AI, intercepted source response,
// production data, native vector coordinates or fabricated physical measurements.
test.describe('обводка сканированного PDF', () => {
  test.setTimeout(90_000)
  test.use({
    extraHTTPHeaders: {
      origin,
      'x-forwarded-for': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`,
    },
  })

  test.beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    const endpoint = new URL(process.env.S3_ENDPOINT ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(connection.hostname) &&
        connection.port === '5432' &&
        connection.pathname === '/uyut',
      'Нужна изолированная локальная БД localhost:5432/uyut',
    )
    assert(
      ['localhost', '127.0.0.1'].includes(endpoint.hostname) && endpoint.port === '9000',
      'Нужен изолированный локальный S3 на порту 9000',
    )
    assert.equal(process.env.APP_URL, origin)
    storage = new S3Client({
      endpoint: endpoint.toString(),
      region: process.env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY as string,
        secretAccessKey: process.env.S3_SECRET_KEY as string,
      },
    })
    const source = await readFile(resolve('e2e/fixtures/synthetic-scanned-plan.pdf'))
    sourceSha256 = createHash('sha256').update(source).digest('hex')
    await storage.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: planUrl,
        Body: source,
        ContentType: 'application/pdf',
      }),
    )
    database = createDb(connection.toString())
    const [owner] = await database
      .insert(users)
      .values({ email, emailVerified: true, displayName: 'Синтетический PDF-скан' })
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
        title: `Синтетический PDF-скан, не обмер ${run}`,
        planUrl,
        planReading: {
          ...realisticBalconyApartment.reading,
          sourcePage: 1,
          planState: 'existing',
          geometry,
        },
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

  test('частный растр, две размерные линии и пять углов сохраняются с привязкой к PDF', async ({
    page,
  }) => {
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    const project = await savedProject()
    const route = `/api/projects/${projectId}/plan-page?page=1&revision=${planEditRevision(project.planUrl, project.planReading)}`
    const native = await page.request.get(route)
    expect(native.status()).toBe(422)
    const points = await page.request.get(`${route}&format=points`)
    expect(points.status()).toBe(422)
    const raster = await page.request.get(`${route}&format=raster`)
    expect(raster.status()).toBe(200)
    expect(raster.headers()['content-type']).toBe('image/jpeg')
    expect(raster.headers()['cache-control']).toBe('private, no-store')
    expect(raster.headers()['x-plan-sha256']).toBe(sourceSha256)
    expect(raster.headers()['x-plan-page']).toBe('1')
    expect(raster.headers()['x-plan-page-count']).toBe('1')
    expect(raster.headers()['x-plan-page-width']).toBeUndefined()

    await page.goto(`/projects/${projectId}`)
    await page.getByRole('button', { name: 'Проверить схему', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Проверка 2D-схемы', exact: true })
    const image = dialog.getByRole('img', { name: 'Исходный план квартиры', exact: true })
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0)
    const size = await image.evaluate((element: HTMLImageElement) => ({
      width: element.naturalWidth,
      height: element.naturalHeight,
    }))
    expect(size.width).toBe(Number(raster.headers()['x-plan-image-width']))
    expect(size.height).toBe(Number(raster.headers()['x-plan-image-height']))
    const x = (pixel: number) => Math.round((pixel * size.width) / 820)
    const y = (pixel: number) => Math.round((pixel * size.height) / 970)
    for (const index of [0, 1]) {
      await dialog.getByRole('button', { name: 'Добавить точку вручную', exact: true }).click()
      await dialog.locator(`#plan-pixel-${index}-x`).fill(String(x(index === 0 ? 110 : 710)))
      await dialog.locator(`#plan-pixel-${index}-y`).fill(String(y(110)))
    }
    await dialog.locator('#plan-known-distance').fill('600')
    await dialog.locator('#plan-world-start-x').fill('40')
    await dialog.locator('#plan-world-start-y').fill('40')
    await dialog.getByRole('button', { name: 'Применить калибровку', exact: true }).click()
    await dialog.getByRole('button', { name: 'Проверить ещё размер', exact: true }).click()
    for (const index of [0, 1]) {
      await dialog.getByRole('button', { name: 'Добавить точку вручную', exact: true }).click()
      await dialog.locator(`#check-${index}-x`).fill(String(x(110)))
      await dialog.locator(`#check-${index}-y`).fill(String(y(index === 0 ? 110 : 710)))
    }
    await dialog.locator('#check-length').fill('600')
    await dialog.getByRole('button', { name: 'Сверить размер', exact: true }).click()
    await expect(
      dialog.getByText('Размеры сошлись в двух направлениях.', { exact: false }),
    ).toBeVisible()
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption('room:4')
    const trace = dialog.locator('details').filter({
      has: page.locator('summary', { hasText: 'Обвести на исходнике · Балкон' }),
    })
    await trace.locator('summary').click()
    await trace.getByRole('button', { name: 'Начать новую обводку', exact: true }).click()
    const vertices = [
      [460, 740],
      [710, 740],
      [710, 810],
      [660, 860],
      [460, 860],
    ]
    for (const [index, vertex] of vertices.entries()) {
      assert(vertex[0] !== undefined && vertex[1] !== undefined)
      await addVertex(trace, index + 1, x(vertex[0]), y(vertex[1]))
    }
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await trace.scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true)
      await trace.screenshot({
        path: resolve(`../../output/playwright/scanned-contour-${viewport.width}.png`),
      })
    }
    await trace.getByRole('button', { name: 'Применить обводку в черновик', exact: true }).click()
    expect((await savedProject()).planReading?.geometry?.rooms[4]?.polygon).toHaveLength(4)
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    await expect
      .poll(async () => (await savedProject()).planReading?.geometry?.rooms[4]?.polygon.length)
      .toBe(5)
    await page.reload()
    await page.getByRole('button', { name: 'Проверить схему', exact: true }).click()
    await expect(
      dialog.getByRole('img', { name: 'Исходный план квартиры', exact: true }),
    ).toBeVisible()
    const saved = (await savedProject()).planReading?.geometry
    expect(saved?.status).toBe('draft')
    expect(saved?.footprint).toEqual(geometry.footprint)
    expect(saved?.imageCalibration?.sourceSha256).toBe(sourceSha256)
    expect(saved?.imageCalibration?.pdfPage).toBe(1)
    expect(saved?.imageCalibration?.verificationLines).toHaveLength(1)
    const expected = realisticBalconyApartment.geometry.rooms[4]?.polygon
    assert(expected && saved?.rooms[4])
    for (const [index, point] of saved.rooms[4].polygon.entries()) {
      const target = expected[index]
      assert(target)
      expect(Math.abs(point.xCm - target.xCm)).toBeLessThan(0.3)
      expect(Math.abs(point.yCm - target.yCm)).toBeLessThan(0.3)
    }
  })
})
