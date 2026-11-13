import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { concepts, createDb, projectExports, projects, rooms } from '@uyut/db'
import { eq } from 'drizzle-orm'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`

test.describe('recovery without external jobs', () => {
  test.skip(Boolean(process.env.TRIGGER_SECRET_KEY), 'Fixtures must never query a real queue')
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: {
      origin,
      'x-forwarded-for': `10.29.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
    },
  })

  test('keeps old results and requires status before retrying generation or PDF', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const db = createDb(process.env.DATABASE_URL as string)
    let projectId = ''
    try {
      await page.goto('/register')
      await page.getByLabel('Почта').fill(`recovery-${randomUUID()}@example.test`)
      await page.getByLabel('Пароль', { exact: true }).fill('test-recovery-2026')
      await page.getByLabel('Ещё раз').fill('test-recovery-2026')
      await page.getByLabel(/согласие/).check()
      await page.getByRole('button', { name: 'Создать аккаунт' }).tap()
      await expect(page).toHaveURL(/\/verify-email/)
      await page.goto('/onboarding/step-1')
      await page.getByLabel('Название проекта').fill('Восстановление без очереди')
      await page.getByRole('button', { name: 'Дальше' }).tap()
      await expect(page).toHaveURL(/\/onboarding\/step-2\?project=/)
      projectId = new URL(page.url()).searchParams.get('project') ?? ''
      const [room] = await db.select().from(rooms).where(eq(rooms.projectId, projectId)).limit(1)
      if (!room) throw new Error('Test room missing')
      const batchId = randomUUID()
      const readyId = randomUUID()
      const pendingId = randomUUID()
      await db.insert(concepts).values([
        {
          id: readyId,
          roomId: room.id,
          batchId: randomUUID(),
          status: 'ready',
          prompt: 'fixture',
          aiModel: 'fixture',
          renderUrl: 'test/previous-render.webp',
          likedByOwner: false,
          createdAt: new Date(Date.now() - 60_000),
        },
        {
          id: pendingId,
          roomId: room.id,
          batchId,
          status: 'pending',
          prompt: 'fixture',
          aiModel: 'fixture',
          createdAt: new Date(),
        },
      ])
      await db
        .update(rooms)
        .set({
          generationRunId: `pending:${batchId}`,
          generationBatchId: batchId,
          generationStartedAt: new Date(),
        })
        .where(eq(rooms.id, room.id))
      const roomUrl = `/projects/${projectId}/rooms/${room.id}`
      await page.goto(roomUrl)
      const status = page.getByRole('button', { name: 'Проверить статус генерации', exact: true })
      await expect(status).toBeVisible()
      await expect(page.getByRole('button', { name: /^Сгенерировать/ })).toHaveCount(0)
      await status.tap()
      await expect(status).toBeEnabled()
      await expect(
        page.getByText('Статус запуска пока не подтверждён.', { exact: false }),
      ).toBeVisible()
      await page.reload()
      await expect(status).toBeVisible()
      await expect(page.locator(`a[href="${roomUrl}/concepts/${readyId}"]`)).toBeVisible()

      // Simulate the reconciler's terminal write, never launch a worker.
      await db.update(concepts).set({ status: 'failed' }).where(eq(concepts.id, pendingId))
      await db
        .update(rooms)
        .set({ generationRunId: null, generationBatchId: null, generationStartedAt: null })
        .where(eq(rooms.id, room.id))
      await status.tap()
      await expect(page.getByRole('button', { name: /^Сгенерировать/ })).toBeEnabled()
      await expect(page.locator(`a[href="${roomUrl}/concepts/${readyId}"]`)).toBeVisible()

      const exportId = randomUUID()
      await db.insert(projectExports).values([
        {
          projectId,
          kind: 'free',
          status: 'ready',
          pdfKey: 'test/previous.pdf',
          createdAt: new Date(Date.now() - 60_000),
        },
        { id: exportId, projectId, kind: 'free', status: 'pending', createdAt: new Date() },
      ])
      await page.goto(`/projects/${projectId}/summary`)
      const pdfStatus = page.getByRole('button', { name: 'Проверить статус PDF', exact: true })
      const pdfStart = page.getByRole('button', {
        name: 'Бесплатно собрать PDF с водяным знаком',
        exact: true,
      })
      await expect(pdfStatus).toBeVisible()
      await expect(pdfStart).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Скачать', exact: true })).toBeVisible()
      await pdfStatus.tap()
      await expect(pdfStatus).toBeEnabled()
      await expect(pdfStart).toHaveCount(0)
      await page.reload()
      await expect(pdfStatus).toBeVisible()
      await db
        .update(projectExports)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(eq(projectExports.id, exportId))
      await pdfStatus.tap()
      await expect(pdfStart).toBeEnabled()
      await expect(page.getByRole('link', { name: 'Скачать', exact: true })).toBeVisible()
      await expect(
        page.getByText('PDF не собрался. Можно запустить сборку ещё раз.', { exact: true }),
      ).toBeVisible()
    } finally {
      if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    }
  })
})
