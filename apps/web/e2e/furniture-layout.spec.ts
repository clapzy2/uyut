import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
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
const email = `furniture-layout-${run}@example.test`
const password = `furniture-${randomUUID()}`
const title = 'Синтетическая тестовая тумба, не товар для покупки'
let db: Database | undefined
let userId = ''
let projectId = ''
let roomId = ''
let productId = ''
let itemId = ''

async function savedItem() {
  assert(db)
  const [item] = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId))
  assert(item)
  return item
}

test.describe('синтетическая расстановка мебели, не распознавание реального плана', () => {
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
      'Только отдельная локальная БД, не production-туннель',
    )
    assert(process.env.APP_URL === origin, 'APP_URL должен совпадать с локальным адресом теста')
    db = createDb(connection.toString())
    const [owner] = await db
      .insert(users)
      .values({
        email,
        emailVerified: true,
        displayName: 'Синтетическая проверка мебели',
      })
      .returning()
    assert(owner)
    userId = owner.id
    await db.insert(accounts).values({
      userId,
      accountId: userId,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    const [project] = await db
      .insert(projects)
      .values({
        ownerId: userId,
        title: `Тест мебели ${run}, синтетические размеры`,
      })
      .returning()
    assert(project)
    projectId = project.id
    const [room] = await db
      .insert(rooms)
      .values({
        projectId,
        kind: 'living',
        name: 'Синтетическая гостиная',
        measurements: {
          widthCm: 320,
          depthCm: 600,
          layoutNotes: 'Дверь слева у верхнего угла, ширина150см',
        },
      })
      .returning()
    assert(room)
    roomId = room.id
    const [product] = await db
      .insert(catalogItems)
      .values({
        source: 'dump',
        externalId: run,
        category: 'storage',
        title,
        priceKopecks: 10000,
        affiliateUrl: 'https://example.test/synthetic-cabinet',
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
        quantity: 1,
        dimensionsCm: { width: 50, depth: 40, height: 80 },
        operationClearanceCm: { front: 30 },
        placementCm: { xCm: 0, yCm: 110, rotation: 0, frontDirection: 'right' },
      })
      .returning()
    assert(item)
    itemId = item.id
  })

  test.afterAll(async () => {
    if (!db) return
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    if (productId) await db.delete(catalogItems).where(eq(catalogItems.id, productId))
    if (userId) await db.delete(users).where(eq(users.id, userId))
  })

  test('не сужает дверь после запятой, сохраняет размер через форму и держит расстановку черновой', async ({
    page,
  }) => {
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}/rooms/${roomId}`)
    const plan = page.locator('#room-plan')
    const furniture = plan.getByRole('button', { name: `Переместить: ${title}`, exact: true })
    await expect(plan).toBeVisible()
    await expect(furniture).toHaveCount(0)
    await expect(
      plan.getByText(
        `${title}: заданное место перекрывает дверь, окно, радиатор или их обязательную свободную зону.`,
      ),
    ).toBeVisible()

    // Изолированная фикстура: сдвигаем тот же предмет за пределы двери 0..150 см.
    assert(db)
    await db
      .update(shoppingListItems)
      .set({
        placementCm: { xCm: 0, yCm: 200, rotation: 0, frontDirection: 'right' },
      })
      .where(eq(shoppingListItems.id, itemId))
    await page.reload()
    await expect(furniture).toHaveCount(1)
    await expect(
      plan.locator('#room-checks').getByText('Дополните данные для проверки'),
    ).toBeVisible()
    await expect(plan.locator('#room-checks').getByText('Базовые проверки пройдены')).toHaveCount(0)
    await expect(plan.getByText(/предварительный запас 90 см/).first()).toBeVisible()
    const route = plan.locator('li').filter({ hasText: 'Непрерывный проход по комнате' })
    await expect(route.getByText('Предварительно', { exact: true })).toBeVisible()
    await expect(route.getByText('Проверено', { exact: true })).toHaveCount(0)

    const panel = page.locator('#room-item-sizes')
    await panel.locator('summary').click()
    await panel.getByLabel(`Ширина, см: ${title}`, { exact: true }).fill('52')
    await panel.getByLabel(`Глубина, см: ${title}`, { exact: true }).fill('42')
    await panel.getByLabel(`Высота, см: ${title}`, { exact: true }).fill('82')
    await panel.getByRole('button', { name: 'Сохранить свои размеры', exact: true }).click()
    await expect
      .poll(async () => (await savedItem()).dimensionsCm)
      .toEqual({ width: 52, depth: 42, height: 82 })
    await page.reload()
    await expect(furniture).toHaveCount(1)
    await panel.locator('summary').click()
    await expect(panel.getByLabel(`Ширина, см: ${title}`, { exact: true })).toHaveValue('52')
    await expect(panel.getByLabel(`Глубина, см: ${title}`, { exact: true })).toHaveValue('42')
    await expect(panel.getByLabel(`Высота, см: ${title}`, { exact: true })).toHaveValue('82')
    expect((await savedItem()).placementCm).toMatchObject({ xCm: 0, yCm: 200 })
    await expect(
      plan.locator('#room-checks').getByText('Дополните данные для проверки'),
    ).toBeVisible()
    const operations = plan
      .locator('details')
      .filter({ hasText: 'Рабочие зоны мебели · уточнить точность' })
    await operations.locator('summary').click()
    const operationInput = operations.getByLabel(`Запас перед предметом, см: ${title}`, {
      exact: true,
    })
    await operationInput.fill('60,5')
    await operations.getByRole('button', { name: 'Обновить', exact: true }).click()
    await expect.poll(async () => (await savedItem()).operationClearanceCm).toEqual({ front: 60.5 })
    await page.reload()
    await operations.locator('summary').click()
    await expect(operationInput).toHaveValue('60.5')
    await operations.getByRole('button', { name: 'Убрать запас', exact: true }).click()
    await expect.poll(async () => (await savedItem()).operationClearanceCm).toBeNull()
    await page.reload()
    await operations.locator('summary').click()
    await expect(operationInput).toHaveValue('')
    await expect(operations.getByRole('button', { name: 'Убрать запас', exact: true })).toHaveCount(
      0,
    )
    const afterReset = await savedItem()
    expect(afterReset.dimensionsCm).toEqual({ width: 52, depth: 42, height: 82 })
    expect(afterReset.placementCm).toMatchObject({ xCm: 0, yCm: 200 })
  })
})
