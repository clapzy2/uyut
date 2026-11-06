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
import { realisticBalconyApartment } from '../../../jobs/fixtures/realistic-balcony-apartment'
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

  test.beforeEach(async () => {
    assert(db)
    await db.update(projects).set({ planReading: null }).where(eq(projects.id, projectId))
    await db
      .update(rooms)
      .set({
        kind: 'living',
        measurements: {
          widthCm: 320,
          depthCm: 600,
          layoutNotes: 'Дверь слева у верхнего угла, ширина150см',
        },
      })
      .where(eq(rooms.id, roomId))
    await db.update(catalogItems).set({ category: 'storage' }).where(eq(catalogItems.id, productId))
    await db
      .update(shoppingListItems)
      .set({
        dimensionsCm: { width: 50, depth: 40, height: 80 },
        operationClearanceCm: { front: 30 },
        placementCm: { xCm: 0, yCm: 110, rotation: 0, frontDirection: 'right' },
      })
      .where(eq(shoppingListItems.id, itemId))
  })

  test('сохраняет только явно заданное открывание и удаляет его через второй редактор', async ({
    page,
  }) => {
    assert(db)
    const geometry = structuredClone(realisticBalconyApartment.geometry)
    geometry.status = 'draft'
    delete geometry.confirmedAt
    for (const opening of geometry.openings) delete opening.clearance
    const door = geometry.openings.find((opening) => opening.type === 'door')
    assert(door)
    await db
      .update(projects)
      .set({
        planReading: { ...realisticBalconyApartment.reading, geometry },
      })
      .where(eq(projects.id, projectId))
    const savedDoor = async () => {
      assert(db)
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
      return project?.planReading?.geometry?.openings.find((opening) => opening.id === door.id)
    }
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}`)
    const open = page.getByRole('button', { name: 'Проверить схему', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Проверка 2D-схемы', exact: true })
    await open.click()
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption(`opening:${door.id}`)
    await dialog
      .getByLabel('Куда открывается', { exact: true })
      .filter({ visible: true })
      .selectOption('left')
    await expect(
      dialog.getByLabel('Глубина свободной зоны, см', { exact: true }).filter({ visible: true }),
    ).toHaveValue('')
    await expect(
      dialog.getByLabel('Форма зоны', { exact: true }).filter({ visible: true }),
    ).toHaveValue('')
    await expect(dialog.getByRole('button', { name: 'Применить зону', exact: true })).toBeDisabled()
    // Choosing a side alone must never persist a guessed leaf size or hinge.
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect((await savedDoor())?.clearance).toBeUndefined()
    await page.reload()
    await open.click()
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption(`opening:${door.id}`)
    await dialog
      .getByLabel('Куда открывается', { exact: true })
      .filter({ visible: true })
      .selectOption('left')
    await dialog
      .getByLabel('Форма зоны', { exact: true })
      .filter({ visible: true })
      .selectOption('swing')
    await dialog
      .getByLabel('Длина створки, см', { exact: true })
      .filter({ visible: true })
      .fill('80,5')
    await expect(dialog.getByLabel('Петли', { exact: true }).filter({ visible: true })).toHaveValue(
      '',
    )
    await expect(dialog.getByRole('button', { name: 'Применить зону', exact: true })).toBeDisabled()
    await dialog.getByLabel('Петли', { exact: true }).filter({ visible: true }).selectOption('end')
    await dialog.getByRole('button', { name: 'Применить зону', exact: true }).click()
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    const expected = { side: 'left', shape: 'swing', hinge: 'end', depthCm: 80.5 }
    await expect.poll(async () => (await savedDoor())?.clearance).toEqual(expected)
    await page.reload()
    await open.click()
    await dialog.getByLabel('Элемент схемы', { exact: true }).selectOption(`opening:${door.id}`)
    await expect(
      dialog.getByLabel('Длина створки, см', { exact: true }).filter({ visible: true }),
    ).toHaveValue('80.5')
    await expect(dialog.getByLabel('Петли', { exact: true }).filter({ visible: true })).toHaveValue(
      'end',
    )
    // The kitchen editor edits the same zone, not a second inferred copy.
    const zones = dialog
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: 'Свободные зоны дверей' }) })
    await zones.locator('summary').click()
    const firstDoor = zones.locator('fieldset').first()
    await firstDoor.getByRole('button', { name: 'Убрать зону', exact: true }).click()
    await expect(dialog.getByLabel('Элемент схемы', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    await expect.poll(async () => (await savedDoor())?.clearance).toBeUndefined()
    expect((await savedDoor())?.widthCm).toBe(door.widthCm)
  })

  test('сохраняет рабочую сторону при переносе и поворачивает её вместе с корпусом', async ({
    page,
  }) => {
    assert(db)
    await db
      .update(rooms)
      .set({ measurements: { widthCm: 400, depthCm: 400 } })
      .where(eq(rooms.id, roomId))
    await db
      .update(shoppingListItems)
      .set({
        placementCm: { xCm: 100, yCm: 0, rotation: 0 },
      })
      .where(eq(shoppingListItems.id, itemId))
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}/rooms/${roomId}`)
    const overlay = page.getByLabel('Перемещение мебели по плану')
    await expect(overlay).toHaveAttribute('data-ready', 'true')
    const movable = overlay.getByRole('button', { name: `Переместить: ${title}`, exact: true })
    await movable.scrollIntoViewIfNeeded()
    const box = await movable.boundingBox()
    assert(box)
    const hitbox = await movable.locator('[data-hitbox]').boundingBox()
    assert(hitbox)
    const scale = hitbox.width / 50
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box.x + box.width / 2 - 100 * scale,
      box.y + box.height / 2 + 100 * scale,
      { steps: 8 },
    )
    await expect(movable).toHaveAttribute('data-preview', 'valid')
    await page.mouse.up()
    await expect
      .poll(async () => (await savedItem()).placementCm)
      .toMatchObject({
        xCm: 0,
        rotation: 0,
        frontDirection: 'down',
      })
    const moved = (await savedItem()).placementCm
    assert(moved)
    expect(moved.yCm).toBeGreaterThan(50)
    expect(moved.yCm).toBeLessThan(150)
    await page.reload()
    await expect(overlay).toHaveAttribute('data-ready', 'true')
    expect((await savedItem()).operationClearanceCm).toEqual({ front: 30 })

    // Снова автоматическое направление от верхней стены. Поворот обязан
    // закрепить повернутый фронт, а не заново направить его от той же стены.
    await db
      .update(shoppingListItems)
      .set({
        placementCm: { xCm: 100, yCm: 0, rotation: 0 },
      })
      .where(eq(shoppingListItems.id, itemId))
    await page.reload()
    await expect(overlay).toHaveAttribute('data-ready', 'true')
    await overlay.getByRole('button', { name: `Повернуть: ${title}`, exact: true }).click()
    await expect
      .poll(async () => (await savedItem()).placementCm)
      .toEqual({
        xCm: 100,
        yCm: 0,
        rotation: 90,
        frontDirection: 'left',
      })
    await page.reload()
    await expect(movable).toBeVisible()
    expect((await savedItem()).placementCm?.frontDirection).toBe('left')
  })

  test('не разрешает поворот кровати, если боковой подход окажется за стеной', async ({ page }) => {
    assert(db)
    await db
      .update(rooms)
      .set({ kind: 'bedroom', measurements: { widthCm: 400, depthCm: 400 } })
      .where(eq(rooms.id, roomId))
    await db.update(catalogItems).set({ category: 'bed' }).where(eq(catalogItems.id, productId))
    // Контрольная геометрия и запас, не обмеры квартиры и не инструкция товара.
    const placement = { xCm: 60, yCm: 0, rotation: 0 as const }
    await db
      .update(shoppingListItems)
      .set({
        dimensionsCm: { width: 151, depth: 210, height: 80 },
        operationClearanceCm: { side: 45 },
        placementCm: placement,
      })
      .where(eq(shoppingListItems.id, itemId))
    const login = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.goto(`/projects/${projectId}/rooms/${roomId}`)
    const overlay = page.getByLabel('Перемещение мебели по плану')
    await expect(overlay).toHaveAttribute('data-ready', 'true')
    await overlay.getByRole('button', { name: `Повернуть: ${title}`, exact: true }).click()
    await expect(
      page.getByText('После поворота не хватает места для открывания или использования', {
        exact: true,
      }),
    ).toBeVisible()
    expect((await savedItem()).placementCm).toEqual(placement)
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
    const access = plan.locator('li').filter({ hasText: 'Доступ к рабочим зонам мебели' })
    await expect(access.getByText('Предварительно', { exact: true })).toBeVisible()
    await expect(access.getByText('Проверено', { exact: true })).toHaveCount(0)
    await expect(
      access.getByText(/На предварительной схеме путь к рабочим зонам найден/),
    ).toBeVisible()

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
