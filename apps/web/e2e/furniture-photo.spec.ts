import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { expect, test } from '@playwright/test'
import { createDb, projects, rooms } from '@uyut/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { putObject } from '../../../jobs/src/lib/s3'

test.use({
  extraHTTPHeaders: {
    origin: `http://localhost:${process.env.PORT ?? '3000'}`,
    'x-forwarded-for': `10.30.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
  },
})

test('отдельное фото предмета не заменяет фото комнаты и сбрасывается при смене исходника', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.FAL_KEY || process.env.TRIGGER_SECRET_KEY),
    'No paid services in this test',
  )
  test.setTimeout(60_000)
  const endpoint = process.env.S3_ENDPOINT as string
  if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname))
    throw new Error('Local storage only')
  const storage = new S3Client({
    endpoint,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY as string,
      secretAccessKey: process.env.S3_SECRET_KEY as string,
    },
  })
  const db = createDb(process.env.DATABASE_URL as string)
  let projectId = ''
  let roomId = ''
  const originalKey = `test/furniture-photo-${randomUUID()}.png`
  const photo = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#79736b' },
  })
    .png()
    .toBuffer()
  try {
    await page.goto('/register')
    await page.getByLabel('Почта').fill(`furniture-${randomUUID()}@example.test`)
    await page.getByLabel('Пароль', { exact: true }).fill('test-furniture-2026')
    await page.getByLabel('Ещё раз').fill('test-furniture-2026')
    await page.getByLabel(/согласие/).check()
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page).toHaveURL(/\/verify-email/)
    await page.goto('/onboarding/step-1')
    await page.getByLabel('Название проекта').fill('Проверка второго фото')
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=/)
    projectId = new URL(page.url()).searchParams.get('project') ?? ''
    const [room] = await db.select().from(rooms).where(eq(rooms.projectId, projectId)).limit(1)
    if (!room) throw new Error('Test room missing')
    roomId = room.id
    await putObject(originalKey, photo, 'image/png')
    await db
      .update(rooms)
      .set({
        condition: 'keep',
        photoUrl: originalKey,
        photoRevision: 1,
        notes: 'Переставить существующий комод под окно.',
      })
      .where(eq(rooms.id, roomId))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/projects/${projectId}/rooms/${roomId}`)
    await page.getByRole('radio', { name: 'Выделить на фото комнаты', exact: true }).check()
    await expect(
      page.getByRole('button', { name: 'Выделить исходный предмет для переноса', exact: true }),
    ).toBeVisible()
    await page.getByRole('radio', { name: 'Отдельное фото предмета', exact: true }).check()
    const input = page.getByLabel('Загрузить отдельное фото предмета', { exact: true })
    await expect(input).toBeEnabled()
    await input.setInputFiles({ name: 'chest.png', mimeType: 'image/png', buffer: photo })
    await expect(
      page.getByRole('img', { name: 'Прикреплённый предмет для переноса' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Перенести выделенный предмет - 1 вариант' }),
    ).toBeEnabled()
    await expect(page.getByText('три варианта, около минуты', { exact: true })).toHaveCount(0)
    const [unchanged] = await db.select().from(rooms).where(eq(rooms.id, roomId))
    expect(unchanged?.photoUrl).toBe(originalKey)
    expect(unchanged?.generationRunId).toBeNull()
    await expect(input).toBeEnabled()
    await input.setInputFiles({
      name: 'bad.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    })
    await expect(page.getByRole('alert').filter({ hasText: 'не похоже' })).toBeVisible()
    await expect(
      page.getByRole('img', { name: 'Прикреплённый предмет для переноса' }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('img', { name: 'Прикреплённый предмет для переноса' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Перенести выделенный предмет - 1 вариант' }),
    ).toBeEnabled()
    await page.getByRole('radio', { name: 'Выделить на фото комнаты', exact: true }).check()
    await expect(
      page.getByRole('button', { name: 'Сгенерировать концепты', exact: true }),
    ).toBeVisible()
    await page.getByRole('radio', { name: 'Отдельное фото предмета', exact: true }).check()
    await expect(
      page.getByRole('img', { name: 'Прикреплённый предмет для переноса' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Перенести выделенный предмет - 1 вариант' }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Не использовать это фото', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Прикреплённый предмет для переноса' })).toHaveCount(
      0,
    )
    const [detached] = await db.select().from(rooms).where(eq(rooms.id, roomId))
    expect(detached?.furnitureReference).toBeNull()
    await page.reload()
    await expect(page.getByRole('img', { name: 'Прикреплённый предмет для переноса' })).toHaveCount(
      0,
    )
    await expect(input).toBeEnabled()
    await input.setInputFiles({ name: 'chest.png', mimeType: 'image/png', buffer: photo })
    await expect(
      page.getByRole('img', { name: 'Прикреплённый предмет для переноса' }),
    ).toBeVisible()
    await db.update(rooms).set({ photoRevision: 2 }).where(eq(rooms.id, roomId))
    await page.reload()
    await expect(page.getByRole('img', { name: 'Прикреплённый предмет для переноса' })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole('button', { name: 'Сгенерировать концепты', exact: true }),
    ).toBeEnabled()
  } finally {
    if (roomId && projectId) {
      const prefix = `projects/${projectId}/rooms/${roomId}/furniture-references/`
      const found = await storage.send(
        new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix }),
      )
      for (const item of found.Contents ?? []) {
        if (item.Key?.startsWith(prefix))
          await storage.send(
            new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: item.Key }),
          )
      }
    }
    await storage.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: originalKey }))
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    storage.destroy()
    await db.$client.end()
  }
})
