import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  accounts,
  catalogItems,
  createDb,
  type Database,
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
const password = `measurement-${randomUUID()}`
const ownerEmail = `measurement-owner-${run}@example.test`
const outsiderEmail = `measurement-outsider-${run}@example.test`
const headers = {
  origin,
  'x-forwarded-for': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`,
}
type MeasurementAction = 'setItemSize' | 'setItemPlacement' | 'setItemOperationClearance'
const actionIds = new Map<MeasurementAction, string>()
let db: Database | undefined
const userIds: string[] = []
let projectId = ''
let roomId = ''
let itemId = ''
let productId = ''

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email, password },
  })
  expect(response.status()).toBe(200)
  expect(
    (await request.storageState()).cookies.some((cookie) => cookie.name.endsWith('session_token')),
  ).toBe(true)
}

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

async function action(request: APIRequestContext, name: MeasurementAction, input: unknown) {
  const id = actionIds.get(name)
  assert(id, `Действие ${name} отсутствует в проверяемой сборке`)
  const response = await request.post('/projects', {
    headers: { origin, 'next-action': id, accept: 'text/x-component' },
    // Здесь только UUID и обычные строки/объекты: специальное кодирование Date/FormData не нужно.
    data: JSON.stringify([itemId, input]),
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
  assert(typeof result.ok === 'boolean', `Нет результата действия ${name}`)
  return result
}

async function savedItem() {
  assert(db)
  const [item] = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId))
  assert(item)
  return item
}

// Проверяет HTTP собранного приложения, настоящую сессию и БД, а не vi.mock(getSession).
// Ни браузерный движок, ни платная генерация, ни экспорт в Trigger здесь не запускаются.
test.describe('дробные мерки через HTTP собранного сайта', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ extraHTTPHeaders: headers })

  test.beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    assert(
      ['localhost', '127.0.0.1'].includes(connection.hostname) && connection.port !== '58032',
      'Нужна отдельная локальная БД, не production-туннель',
    )
    assert(process.env.APP_URL === origin, 'APP_URL должен совпадать с локальным адресом теста')
    const manifest = JSON.parse(
      await readFile(resolve('.next/server/server-reference-manifest.json'), 'utf8'),
    ) as { node: Record<string, { exportedName: string }> }
    for (const name of ['setItemSize', 'setItemPlacement', 'setItemOperationClearance'] as const) {
      const matches = Object.entries(manifest.node).filter(
        ([, entry]) => entry.exportedName === name,
      )
      assert(matches.length === 1 && matches[0], `Ожидалось одно действие ${name}`)
      actionIds.set(name, matches[0][0])
    }
    db = createDb(connection.toString())
    const hashed = await hashPassword(password)
    for (const email of [ownerEmail, outsiderEmail]) {
      const [user] = await db
        .insert(users)
        .values({
          email,
          emailVerified: true,
          displayName: 'Локальная проверка мерок',
        })
        .returning()
      assert(user)
      userIds.push(user.id)
      await db.insert(accounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: hashed,
      })
    }
    assert(userIds[0])
    const [project] = await db
      .insert(projects)
      .values({
        ownerId: userIds[0],
        title: `Синтетическая проверка HTTP, не обмер ${run}`,
      })
      .returning()
    assert(project)
    projectId = project.id
    const [room] = await db
      .insert(rooms)
      .values({
        projectId,
        kind: 'living',
        name: 'Гостиная',
        measurements: { widthCm: 400.3, depthCm: 500.4 },
      })
      .returning()
    assert(room)
    roomId = room.id
    const [product] = await db
      .insert(catalogItems)
      .values({
        source: 'dump',
        externalId: run,
        category: 'chair',
        title: 'Тестовый стул с дробными мерками',
        priceKopecks: 10000,
        affiliateUrl: 'https://example.test/chair',
        images: [],
        inStock: true,
        contentHash: run,
      })
      .returning()
    assert(product)
    productId = product.id
    const [list] = await db.insert(shoppingLists).values({ projectId }).returning()
    assert(list)
    const [item] = await db
      .insert(shoppingListItems)
      .values({
        listId: list.id,
        catalogItemId: productId,
        roomId,
      })
      .returning()
    assert(item)
    itemId = item.id
  })

  test.afterAll(async () => {
    if (!db) return
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    if (productId) await db.delete(catalogItems).where(eq(catalogItems.id, productId))
    for (const id of userIds) await db.delete(users).where(eq(users.id, id))
  })

  test('сохраняет десятичные мерки и повторно показывает их в комнате', async ({ request }) => {
    await signIn(request, ownerEmail)
    expect(
      await action(request, 'setItemSize', { width: '105,6', depth: '70.4', height: '85,2' }),
    ).toMatchObject({ ok: true })
    expect(
      await action(request, 'setItemOperationClearance', { front: '50,4', side: '', around: '' }),
    ).toMatchObject({ ok: true })
    expect(
      await action(request, 'setItemPlacement', {
        mode: 'exact',
        xCm: '220,4',
        yCm: '200.2',
        rotation: '90',
      }),
    ).toMatchObject({ ok: true })
    const item = await savedItem()
    expect(item.dimensionsCm).toEqual({ width: 105.6, depth: 70.4, height: 85.2 })
    expect(item.operationClearanceCm).toEqual({ front: 50.4 })
    expect(item.placementCm).toEqual({ xCm: 220.4, yCm: 200.2, rotation: 90 })
    const page = await request.get(`/projects/${projectId}/rooms/${roomId}`)
    expect(page.status()).toBe(200)
    const html = await page.text()
    expect(html).toContain('План комнаты 400.3 на 500.4 сантиметров')
    expect(html).toContain('105.6 × 70.4')
    expect(
      await action(request, 'setItemSize', { width: '105,6', depth: '70,4', height: '' }),
    ).toMatchObject({ ok: true })
    expect((await savedItem()).dimensionsCm).toEqual({ width: 105.6, depth: 70.4 })
    const reopened = await request.get(`/projects/${projectId}/rooms/${roomId}`)
    expect(reopened.status()).toBe(200)
    const reopenedHtml = await reopened.text()
    expect(reopenedHtml).toContain('105.6 × 70.4')
    expect(reopenedHtml).not.toContain('85.2')
  })

  test('отклоняет пустую координату и чужую правку, не меняя запись', async ({
    request,
    playwright,
  }) => {
    await signIn(request, ownerEmail)
    const before = await savedItem()
    expect(
      await action(request, 'setItemPlacement', {
        mode: 'exact',
        xCm: ' ',
        yCm: '200',
        rotation: '0',
      }),
    ).toMatchObject({ ok: false })
    expect((await savedItem()).placementCm).toEqual(before.placementCm)
    const outsider = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: headers,
    })
    try {
      await signIn(outsider, outsiderEmail)
      expect(
        await action(outsider, 'setItemSize', { width: '250', depth: '150', height: '90' }),
      ).toMatchObject({ ok: false })
      expect(
        await action(outsider, 'setItemOperationClearance', { front: '60', side: '', around: '' }),
      ).toMatchObject({ ok: false })
      expect(
        await action(outsider, 'setItemPlacement', {
          mode: 'exact',
          xCm: '10',
          yCm: '10',
          rotation: '0',
        }),
      ).toMatchObject({ ok: false })
      expect((await savedItem()).dimensionsCm).toEqual(before.dimensionsCm)
      expect((await savedItem()).operationClearanceCm).toEqual(before.operationClearanceCm)
      expect((await savedItem()).placementCm).toEqual(before.placementCm)
    } finally {
      await outsider.dispose()
    }
  })
})
