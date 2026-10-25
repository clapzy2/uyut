import assert from 'node:assert/strict'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test } from '@playwright/test'
import {
  accounts,
  createDb,
  type Database,
  type PlanGeometry,
  type PlanProjectedVerticalEvidence,
  projects,
  users,
} from '@uyut/db'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../lib/password'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `projected-floors-${run}@example.test`
const password = `floors-${randomUUID()}`
const planUrl = `synthetic-projected-floors-${run}.pdf`
const dryId = 'synthetic-dry-floor'
const wetId = 'synthetic-wet-floor'
const showerId = 'synthetic-shower'
let database: Database | undefined
let storage: S3Client | undefined
let ownerId = ''
let projectId = ''

/** Three separate native captions; no imported plan or external renderer is needed. */
function syntheticPdf(): Buffer {
  const content = [
    '0.6 w',
    '20 20 250 300 re S',
    '300 20 250 300 re S',
    'BT /F1 12 Tf 50 290 Td (+0.000) Tj ET',
    'BT /F1 12 Tf 330 290 Td (-0.050) Tj ET',
    'BT /F1 12 Tf 440 100 Td (+0.150) Tj ET',
    '',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ]
  let source = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

function geometryFixture(sha256: string): PlanGeometry {
  const rectangle = (left: number, right: number) => [
    { xCm: left, yCm: 20 },
    { xCm: right, yCm: 20 },
    { xCm: right, yCm: 320 },
    { xCm: left, yCm: 320 },
  ]
  const geometry: PlanGeometry = {
    version: 1,
    status: 'draft',
    widthCm: 600,
    heightCm: 400,
    rooms: [
      { name: 'Синтетическая сухая зона', sourceNumber: 1, polygon: rectangle(20, 270) },
      { name: 'Синтетическая мокрая зона', sourceNumber: 2, polygon: rectangle(300, 550) },
    ],
    walls: [],
    openings: [],
    warnings: [],
    pdfCalibration: {
      sourceSha256: sha256,
      pdfPage: 1,
      sourceState: 'proposed',
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
    },
  }
  const statement = (
    id: string,
    roomIndex: number,
    text: string,
    valueCm: number,
    captionIndex: number,
  ): PlanProjectedVerticalEvidence => {
    const room = geometry.rooms[roomIndex]
    assert(room)
    return {
      id,
      quantity: 'floor-level',
      printedValue: text,
      unit: 'm',
      valueCm,
      target: { kind: 'room', room: structuredClone(room) },
      geometrySource: { sha256, pdfPage: 1, state: 'proposed' },
      source: { sha256, pdfPage: 1, captionIndexes: [captionIndex], captionTexts: [text] },
      reviewedAt: new Date().toISOString(),
      reviewedBy: ownerId,
    }
  }
  // Verified through preparePlanPage: native indices are 0, 2, 3, not compact slots 0, 1, 2.
  geometry.projectedVerticalEvidence = [
    statement(dryId, 0, '+0.000', 0, 0),
    statement(wetId, 1, '-0.050', -5, 2),
    statement(showerId, 1, '+0.150', 15, 3),
  ]
  return geometry
}

async function savedGeometry(): Promise<PlanGeometry> {
  assert(database)
  const [project] = await database.select().from(projects).where(eq(projects.id, projectId))
  assert(project?.planReading?.geometry)
  return project.planReading.geometry
}

// Seeded geometry tests the real form and ownership boundary, not Remplanner recognition.
test.describe('синтетическая сверка проектного пола через настоящий интерфейс', () => {
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
    const source = syntheticPdf()
    const sha256 = createHash('sha256').update(source).digest('hex')
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
      .values({ email, emailVerified: true, displayName: 'Синтетические проектные полы' })
      .returning()
    assert(owner)
    ownerId = owner.id
    await database.insert(accounts).values({
      userId: ownerId,
      accountId: ownerId,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    const geometry = geometryFixture(sha256)
    const [project] = await database
      .insert(projects)
      .values({
        ownerId,
        title: `Синтетическая сверка проектных полов ${run}`,
        planUrl,
        planReading: {
          readAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          sourcePage: 1,
          planState: 'proposed',
          rooms: [
            { name: 'Синтетическая сухая зона', sourceNumber: 1, kind: 'living' },
            { name: 'Синтетическая мокрая зона', sourceNumber: 2, kind: 'bath' },
          ],
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

  test('сохраняет явную сверку нулевого пола, но не превращает два уровня мокрой зоны в плоскость', async ({
    page,
  }) => {
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Проектный 3D: уровни пола' })).toHaveCount(0)
    await page.getByText('Сверить целые полы для проектного 3D', { exact: true }).click()
    const review = page.locator('details').filter({
      has: page.locator('summary', { hasText: 'Сверить целые полы для проектного 3D' }),
    })
    await review.getByLabel('Отметка для проектного пола', { exact: true }).selectOption(dryId)
    await review.getByRole('button', { name: 'Открыть лист для сверки пола', exact: true }).click()
    await expect(
      review.getByRole('img', { name: 'Проектный лист 1 для сверки пола', exact: true }),
    ).toBeVisible()
    await review.getByLabel('Нулевая подпись проектного пола', { exact: true }).selectOption('0')
    const save = review.getByRole('button', {
      name: 'Сохранить сверку проектного пола',
      exact: true,
    })
    await expect(save).toBeDisabled()
    await review
      .getByRole('checkbox', { name: /^Сверил: этот уровень относится ко всему контуру/ })
      .check()
    await expect(save).toBeDisabled()
    await review
      .getByRole('checkbox', { name: /^Сверил: отметка комнаты и выбранный ноль/ })
      .check()
    await save.click()
    const preview = page.getByRole('region', { name: 'Проектный 3D: уровни пола', exact: true })
    await expect(preview).toBeVisible()
    await expect(preview.getByText(/Поверхностей с уровнем:/)).toContainText(
      'Поверхностей с уровнем: 1. Без определённой поверхности: 1.',
    )
    const scene = preview.getByRole('img', {
      name: 'Проектный 3D-просмотр уровней пола',
      exact: true,
    })
    const surface = scene.locator('polygon:not([fill="none"])')
    await expect(surface).toHaveCount(1)
    await expect(scene.locator('polygon[fill="none"]')).toHaveCount(1)
    const initialPoints = await surface.getAttribute('points')
    assert(initialPoints)
    await preview.getByRole('button', { name: 'Повернуть влево', exact: true }).click()
    await expect(surface).not.toHaveAttribute('points', initialPoints)
    await preview.getByRole('button', { name: 'Вид сверху', exact: true }).click()
    await expect(preview.getByRole('button', { name: 'Наклонный вид', exact: true })).toBeVisible()
    await preview.getByRole('button', { name: 'Вертикальное увеличение: 1×', exact: true }).click()
    await expect(
      preview.getByRole('button', { name: 'Вертикальное увеличение: 10×', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(preview.getByRole('status')).toContainText('увеличена в 10 раз')
    await preview.getByRole('button', { name: 'Вернуть исходный вид', exact: true }).click()
    await expect(surface).toHaveAttribute('points', initialPoints)
    await expect(preview.getByRole('button', { name: 'Вид сверху', exact: true })).toBeVisible()
    await expect(
      preview.getByRole('button', { name: 'Вертикальное увеличение: 1×', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')

    await page.reload()
    await expect(preview).toBeVisible()
    const saved = await savedGeometry()
    const dry = saved.projectedVerticalEvidence?.find((entry) => entry.id === dryId)
    expect(dry?.floorContourReview).toMatchObject({
      zeroCaptionIndex: 0,
      zeroCaptionText: '+0.000',
      reviewedBy: ownerId,
    })
    expect(dry?.floorContourReview?.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(saved.status).toBe('draft')
    expect(saved.verticalReference).toBeUndefined()
    expect(saved.walls.some((wall) => wall.heightCm !== undefined)).toBe(false)
    await page.getByText('Сверить целые полы для проектного 3D', { exact: true }).click()
    await review.getByLabel('Отметка для проектного пола', { exact: true }).selectOption(wetId)
    await review.getByRole('button', { name: 'Открыть лист для сверки пола', exact: true }).click()
    await review.getByLabel('Нулевая подпись проектного пола', { exact: true }).selectOption('0')
    await review
      .getByRole('checkbox', { name: /^Сверил: этот уровень относится ко всему контуру/ })
      .check()
    await review
      .getByRole('checkbox', { name: /^Сверил: отметка комнаты и выбранный ноль/ })
      .check()
    await save.click()
    await expect(review.getByRole('alert')).toContainText('несколько уровней пола')
    const unchanged = await savedGeometry()
    expect(unchanged).toEqual(saved)
    await expect(surface).toHaveCount(1)
    await expect(scene.locator('polygon[fill="none"]')).toHaveCount(1)
  })
})
