import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  accounts,
  createDb,
  type Database,
  type PlanReading,
  projects,
  rooms,
  users,
} from '@uyut/db'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../lib/password'
import { planEditRevision } from '../lib/projects/plan-edit-revision'

const origin = `http://localhost:${process.env.PORT ?? '3000'}`
const run = randomUUID()
const email = `raster-review-${run}@example.test`
const password = `raster-${randomUUID()}`
const planUrl = 'synthetic-axis-review.png'
const reading: PlanReading = {
  readAt: '2026-10-08T00:00:00.000Z',
  planState: 'existing',
  totalAreaM2: 19.2,
  rooms: [
    { name: 'Гостиная', kind: 'living', sourceNumber: 1, widthCm: 600, depthCm: 320, areaM2: 19.2 },
  ],
}
const widthReviewLabel = 'Сверил горизонтальную ширину комнаты «Гостиная» с исходным изображением'
const depthReviewLabel = 'Сверил вертикальную глубину комнаты «Гостиная» с исходным изображением'
let database: Database | undefined
let ownerId = ''
let projectId = ''
let confirmActionId = ''
const projectIds: string[] = []

async function signIn(request: APIRequestContext) {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email, password },
  })
  expect(response.status()).toBe(200)
}

async function savedRooms() {
  assert(database)
  return database.select().from(rooms).where(eq(rooms.projectId, projectId))
}

function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

// Seed a deliberately swapped AI reading, then exercise the real built UI/action/session/DB.
// No image recognition, rendering, storage upload or paid jobs are requested.
test.describe('явная сверка осей растрового плана', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({
    extraHTTPHeaders: {
      origin,
      'x-forwarded-for': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`,
    },
  })

  test.beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(connection.hostname) && connection.port === '5432',
      'Нужна отдельная локальная тестовая БД на порту 5432, не production-туннель',
    )
    assert(process.env.APP_URL === origin)
    database = createDb(connection.toString())
    const manifest = JSON.parse(
      await readFile(resolve('.next/server/server-reference-manifest.json'), 'utf8'),
    ) as {
      node: Record<string, { exportedName: string }>
    }
    const actions = Object.entries(manifest.node).filter(
      ([, entry]) => entry.exportedName === 'confirmPlanRooms',
    )
    assert(actions.length === 1 && actions[0])
    confirmActionId = actions[0][0]
    const [owner] = await database
      .insert(users)
      .values({
        email,
        emailVerified: true,
        displayName: 'Синтетическая проверка осей',
      })
      .returning()
    assert(owner)
    ownerId = owner.id
    await database.insert(accounts).values({
      userId: ownerId,
      accountId: ownerId,
      providerId: 'credential',
      password: await hashPassword(password),
    })
  })

  test.beforeEach(async () => {
    assert(database)
    const [project] = await database
      .insert(projects)
      .values({
        ownerId,
        title: `Синтетические оси, не обмер ${run}`,
        planUrl,
        planReading: reading,
      })
      .returning()
    assert(project)
    projectId = project.id
    projectIds.push(projectId)
  })

  test.afterAll(async () => {
    if (!database) return
    for (const id of projectIds) await database.delete(projects).where(eq(projects.id, id))
    if (ownerId) await database.delete(users).where(eq(users.id, ownerId))
  })

  test('сервер отклоняет непроверенные оси при обходе формы без записи комнат', async ({
    request,
  }) => {
    await signIn(request)
    const response = await request.post('/projects', {
      headers: { origin, 'next-action': confirmActionId, accept: 'text/x-component' },
      data: JSON.stringify([
        projectId,
        {
          ceilingCm: '',
          condition: 'bare',
          rooms: [
            {
              include: true,
              roomId: '',
              name: 'Гостиная',
              kind: 'living',
              sourceNumber: 1,
              widthCm: '600',
              depthCm: '320',
              ceilingCm: '',
              areaM2: '19.2',
              wish: '',
            },
          ],
        },
        planEditRevision(planUrl, reading),
      ]),
    })
    expect(response.status()).toBe(200)
    const chunks = new Map<string, unknown>()
    for (const line of (await response.text()).split('\n')) {
      const match = line.match(/^([0-9a-f]+):(\{.*\})$/)
      if (match?.[1] && match[2]) chunks.set(match[1], JSON.parse(match[2]))
    }
    const reference = record(chunks.get('0')).a
    const result = record(
      typeof reference === 'string' && reference.startsWith('$@')
        ? chunks.get(reference.slice(2))
        : reference,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Сверьте каждую непустую ось')
    expect(await savedRooms()).toHaveLength(0)
    assert(database)
    const [project] = await database.select().from(projects).where(eq(projects.id, projectId))
    expect(project?.planReading).toEqual(reading)
  })

  test('исправляет переставленные оси, сбрасывает галочку при правке и не подтверждает обмер', async ({
    page,
  }) => {
    await signIn(page.request)
    await page.goto(`/projects/${projectId}`)
    const panel = page.getByRole('group', { name: 'Сверьте данные перед переносом', exact: true })
    const width = panel.getByLabel('Ширина, см', { exact: true })
    const depth = panel.getByLabel('Глубина, см', { exact: true })
    const widthReview = panel.getByLabel(widthReviewLabel, { exact: true })
    const depthReview = panel.getByLabel(depthReviewLabel, { exact: true })
    await expect(width).toHaveValue('600')
    await expect(depth).toHaveValue('320')
    await expect(widthReview).not.toBeChecked()
    await expect(depthReview).not.toBeChecked()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await panel.screenshot({
      path: resolve('../../output/playwright/raster-axis-review-mobile.png'),
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await panel.screenshot({
      path: resolve('../../output/playwright/raster-axis-review-desktop.png'),
    })
    await panel.getByRole('button', { name: 'Перенести комнаты: 1', exact: true }).click()
    await expect(panel.getByText(/Сверьте каждую непустую ось/)).toBeVisible()
    expect(await savedRooms()).toHaveLength(0)

    await width.fill('320')
    await depth.fill('600')
    await widthReview.check()
    await depthReview.check()
    await width.fill('321')
    await expect(widthReview).not.toBeChecked()
    await expect(depthReview).toBeChecked()
    await width.fill('320')
    await widthReview.check()
    await panel.getByRole('button', { name: 'Перенести комнаты: 1', exact: true }).click()
    await expect.poll(async () => (await savedRooms())[0]?.measurements?.widthCm).toBe(320)
    const [saved] = await savedRooms()
    expect(saved?.measurements).toMatchObject({ widthCm: 320, depthCm: 600 })
    expect(saved?.measurements?.verification).toBeUndefined()

    await page.reload()
    await page.getByRole('button', { name: 'Изменить данные с чертежа', exact: true }).click()
    await expect(width).toHaveValue('320')
    await expect(depth).toHaveValue('600')
    await expect(widthReview).not.toBeChecked()
    await expect(depthReview).not.toBeChecked()
  })

  test('явно очищает неподтверждённые размеры и переносит новую комнату без них', async ({
    page,
  }) => {
    await signIn(page.request)
    await page.goto(`/projects/${projectId}`)
    const panel = page.getByRole('group', { name: 'Сверьте данные перед переносом', exact: true })
    await panel.getByRole('button', { name: 'Очистить неподтверждённые оси', exact: true }).click()
    await expect(panel.getByLabel('Ширина, см', { exact: true })).toHaveValue('')
    await expect(panel.getByLabel('Глубина, см', { exact: true })).toHaveValue('')
    await panel.getByRole('button', { name: 'Перенести комнаты: 1', exact: true }).click()
    await expect.poll(async () => (await savedRooms()).length).toBe(1)
    const [saved] = await savedRooms()
    expect(saved?.measurements?.widthCm).toBeUndefined()
    expect(saved?.measurements?.depthCm).toBeUndefined()
    expect(saved?.measurements?.verification).toBeUndefined()
  })
})
