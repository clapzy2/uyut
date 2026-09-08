import { randomUUID } from 'node:crypto'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test } from '@playwright/test'
import { conceptObjects, concepts, createDb, EMBEDDING_DIMENSIONS, projects, rooms } from '@uyut/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'

const PASSWORD = 'lampa-u-okna-2026'
const ORIGIN = `http://localhost:${process.env.PORT ?? '3000'}`

function contextHeaders(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`, origin: ORIGIN }
}

function storage(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT as string,
    region: process.env.S3_REGION as string,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY as string,
      secretAccessKey: process.env.S3_SECRET_KEY as string,
    },
  })
}

async function put(key: string, body: Buffer, contentType: string): Promise<void> {
  await storage().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET as string,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

/**
 * Перекраска предмета на рендере. Генерации в CI нет, поэтому концепт, предмет и обе картинки
 * (рендер и маска) кладём сами: проверяем ровно то, что делает человек — выбрал предмет,
 * ткнул в материал, картинка пересобралась и сохранилась.
 */
test.describe('recolor', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  const email = `recolor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
  let projectId = ''
  let conceptId = ''

  test.use({ extraHTTPHeaders: contextHeaders() })

  test.afterAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url || !projectId) {
      return
    }
    await createDb(url).delete(projects).where(eq(projects.id, projectId))
  })

  test('owner repaints an object and the concept keeps the edited render', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Почта').fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Ещё раз').fill(PASSWORD)
    await page.getByLabel(/согласие/).check()
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page).toHaveURL(/\/verify-email/)

    await page.goto('/onboarding/step-1')
    await page.getByLabel('Название проекта').fill('Квартира с перекраской')
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
    projectId = new URL(page.url()).searchParams.get('project') ?? ''
    expect(projectId).not.toBe('')

    const db = createDb(process.env.DATABASE_URL as string)
    const [room] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.projectId, projectId))
      .limit(1)
    const roomId = room?.id ?? ''
    expect(roomId).not.toBe('')

    // Рендер — однотонное полотно, маска — белый прямоугольник по центру: этого хватает,
    // чтобы обвод маски нашёл предмет и пересчитал пиксели
    const renderKey = `projects/${projectId}/rooms/${roomId}/concepts/e2e-render.webp`
    const maskKey = `projects/${projectId}/rooms/${roomId}/concepts/e2e-mask.png`
    const render = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#8c7f6a' },
    })
      .webp()
      .toBuffer()
    const mask = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#000000' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 320, height: 240, channels: 3, background: '#ffffff' },
          })
            .png()
            .toBuffer(),
          left: 160,
          top: 120,
        },
      ])
      .png()
      .toBuffer()
    await put(renderKey, render, 'image/webp')
    await put(maskKey, mask, 'image/png')

    const [concept] = await db
      .insert(concepts)
      .values({
        roomId,
        batchId: randomUUID(),
        orderIndex: 0,
        status: 'ready',
        prompt: 'e2e recolor',
        aiModel: 'e2e',
        renderUrl: renderKey,
      })
      .returning({ id: concepts.id })
    conceptId = concept?.id ?? ''
    expect(conceptId).not.toBe('')

    await db.insert(conceptObjects).values({
      conceptId,
      orderIndex: 0,
      category: 'sofa',
      label: 'sofa',
      bbox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      maskUrl: maskKey,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
    })

    await page.goto(`/projects/${projectId}/rooms/${roomId}/concepts/${conceptId}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Концепт 1')

    await page.getByRole('button', { name: '1. Диван' }).click()
    const picker = page.getByRole('group', { name: 'Материалы для перекраски' })
    await expect(picker).toBeVisible()

    const swatch = picker.getByRole('button').and(page.locator(':not([disabled])')).first()
    const swatchName = await swatch.getAttribute('aria-label')
    await swatch.click()

    await expect(page.getByText('Диван:').first()).toBeVisible({ timeout: 30_000 })
    expect(swatchName).toBeTruthy()

    // Перекрашенная версия лежит рядом с оригиналом, а не вместо него
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select({ edited: concepts.editedRenderUrl, edits: concepts.edits })
            .from(concepts)
            .where(eq(concepts.id, conceptId))
            .limit(1)
          return row?.edited ? { edited: Boolean(row.edited), edits: row.edits?.length ?? 0 } : null
        },
        { timeout: 30_000 },
      )
      .toEqual({ edited: true, edits: 1 })

    const [after] = await db
      .select({ original: concepts.renderUrl })
      .from(concepts)
      .where(eq(concepts.id, conceptId))
      .limit(1)
    expect(after?.original).toBe(renderKey)
  })
})
