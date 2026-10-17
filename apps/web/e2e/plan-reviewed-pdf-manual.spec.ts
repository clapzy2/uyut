import assert from 'node:assert/strict'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test } from '@playwright/test'
import { accounts, createDb, type Database, type PlanReading, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../lib/password'
import { planEditRevision } from '../lib/projects/plan-edit-revision'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `reviewed-manual-${run}@example.test`
const password = `manual-${randomUUID()}`
const planUrl = `synthetic-reviewed-pdf-${run}.pdf`
let database: Database | undefined
let storage: S3Client | undefined
let ownerId = ''
let projectId = ''
let sourceSha256 = ''
let originalReview: PlanReading['pageReview']

async function savedProject() {
  assert(database)
  const [project] = await database.select().from(projects).where(eq(projects.id, projectId))
  assert(project)
  return project
}

// This synthetic image-only PDF carries a seeded source review to exercise the
// ownership boundary. It is not a DECO recognition or physical geometry acceptance.
test.describe('ручная растровая обводка PDF с сохранённой разметкой исходника', () => {
  test.setTimeout(90_000)
  test.use({
    actionTimeout: 15_000,
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
      'Нужен локальный тестовый S3 localhost:9000',
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
      .values({ email, emailVerified: true, displayName: 'Синтетическая ручная обводка PDF' })
      .returning()
    assert(owner)
    ownerId = owner.id
    await database.insert(accounts).values({
      userId: ownerId,
      accountId: ownerId,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    originalReview = {
      version: 1,
      savedAt: new Date().toISOString(),
      contours: {
        source: { sha256: sourceSha256, pdfPage: 1, state: 'existing' },
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 820,
        pageHeight: 970,
        rooms: [],
      },
    }
    const [project] = await database
      .insert(projects)
      .values({
        ownerId,
        title: `Синтетическая проверка ручного PDF ${run}`,
        planUrl,
        planReading: {
          readAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          sourcePage: 1,
          planState: 'existing',
          rooms: [],
          pageReview: originalReview,
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

  test('явный выбор подложки, калибровка и ручной пол переживают перезагрузку отдельно от разметки PDF', async ({
    page,
  }) => {
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}`)
    await page.getByLabel('Ширина плана, см', { exact: true }).fill('820')
    await page.getByLabel('Высота плана, см', { exact: true }).fill('970')
    await page.getByRole('checkbox', { name: /Чертить вручную по изображению листа 1/ }).check()
    await page.getByRole('button', { name: 'Создать пустой черновик', exact: true }).click()
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
    const x = (pixel: number) => Math.round((pixel * size.width) / 820)
    const y = (pixel: number) => Math.round((pixel * size.height) / 970)
    for (const index of [0, 1]) {
      await dialog.getByRole('button', { name: 'Добавить точку вручную', exact: true }).click()
      await dialog.locator(`#plan-pixel-${index}-x`).fill(String(x(index === 0 ? 110 : 710)))
      await dialog.locator(`#plan-pixel-${index}-y`).fill(String(y(110)))
    }
    await dialog.locator('#plan-known-distance').fill('600')
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
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption('floor:boundary')
    const trace = dialog.locator('details').filter({
      has: page.locator('summary', { hasText: 'Обвести на исходнике · Общая граница пола' }),
    })
    await trace.locator('summary').click()
    await trace.getByRole('button', { name: 'Начать новую обводку', exact: true }).click()
    for (const [index, vertex] of [
      [110, 110],
      [710, 110],
      [710, 810],
      [660, 860],
      [110, 860],
    ].entries()) {
      assert(vertex[0] !== undefined && vertex[1] !== undefined)
      await trace.getByRole('button', { name: 'Добавить угол числом', exact: true }).click()
      await trace
        .getByLabel(`Угол ${index + 1} · X, пикс.`, { exact: true })
        .fill(String(x(vertex[0])))
      await trace
        .getByLabel(`Угол ${index + 1} · Y, пикс.`, { exact: true })
        .fill(String(y(vertex[1])))
    }
    await trace.getByRole('button', { name: 'Применить обводку в черновик', exact: true }).click()
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    await expect
      .poll(async () => (await savedProject()).planReading?.geometry?.footprint?.length)
      .toBe(5)
    await page.reload()
    await page.getByRole('button', { name: 'Проверить схему', exact: true }).click()
    await expect(
      dialog.getByRole('img', { name: 'Исходный план квартиры', exact: true }),
    ).toBeVisible()
    const saved = await savedProject()
    expect(saved.planReading?.geometry?.status).toBe('draft')
    expect(saved.planReading?.geometry?.manualPdfUnderlay).toEqual({ pdfPage: 1, sourceSha256 })
    expect(saved.planReading?.geometry?.imageCalibration?.sourceSha256).toBe(sourceSha256)
    expect(saved.planReading?.geometry?.pdfCalibration).toBeUndefined()
    expect(saved.planReading?.pageReview).toEqual(originalReview)
    const revision = planEditRevision(saved.planUrl, saved.planReading)
    const guides = await page.request.get(
      `/api/projects/${projectId}/plan-raster-edges?revision=${revision}&page=1`,
    )
    expect(guides.status()).toBe(200)
    expect((await guides.json()).source.sha256).toBe(sourceSha256)
  })
})
