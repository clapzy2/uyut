import { expect, type Page, test } from '@playwright/test'
import { upsertFeedItems } from '@uyut/catalog'
import { catalogItems, createDb, rooms, shoppingListItems, shoppingLists } from '@uyut/db'
import { eq } from 'drizzle-orm'

const PASSWORD = 'lampa-u-okna-2026'
const ORIGIN = `http://localhost:${process.env.PORT ?? '3000'}`

function contextHeaders(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`, origin: ORIGIN }
}

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
}

async function registerViaForm(page: Page, email: string): Promise<void> {
  await page.goto('/register')
  await page.getByLabel('Почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Ещё раз').fill(PASSWORD)
  await page.getByLabel(/согласие/).check()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/verify-email/)
}

// Товар в список попадает со страницы концепта, а концептов без ключей моделей в CI нет,
// поэтому строку списка сажаем прямо в базу и проверяем страницу итогов целиком
test.describe('project summary', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  const externalId = `e2e-sofa-${Date.now()}`

  test.afterAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) {
      return
    }
    const db = createDb(url)
    await db.delete(catalogItems).where(eq(catalogItems.externalId, externalId))
  })

  test('estimates works by room area, shows the list and lets the owner edit it', async ({
    page,
  }) => {
    await registerViaForm(page, uniqueEmail('summary'))

    await page.goto('/onboarding/step-1')
    await page.getByLabel('Название проекта').fill('Квартира на Мира')
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
    const projectId = new URL(page.url()).searchParams.get('project') ?? ''

    // Комната с площадью: 18,4 м² черновой отделки → 18,4 × (15 000 + 5 000) = 368 000 ₽
    await page.goto(`/projects/${projectId}`)
    await page.getByRole('button', { name: 'Добавить комнату' }).click()
    await page.getByLabel('Площадь, м²').fill('18,4')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByText('18,4 м²')).toBeVisible()

    await page.getByRole('link', { name: 'Список покупок и смета' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/summary$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Итоги проекта')
    await expect(page.getByText('Список пока пуст.')).toBeVisible()
    const estimate = page.getByRole('region', { name: 'Смета' })
    await expect(estimate.getByText(/368\s000\s₽/)).toBeVisible()

    // Строка списка появляется из базы, дальше всё через интерфейс
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('нужен DATABASE_URL, чтобы подложить товар в список')
    }
    const db = createDb(url)
    await upsertFeedItems(db, [
      {
        source: 'dump',
        externalId,
        category: 'sofa',
        title: 'Диван Букле e2e',
        priceKopecks: 67_900_00,
        affiliateUrl: 'https://example.test/sofa',
        images: [],
        inStock: true,
      },
    ])
    const [product] = await db
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(eq(catalogItems.externalId, externalId))
    const [room] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.projectId, projectId))
    const [list] = await db
      .insert(shoppingLists)
      .values({ projectId })
      .returning({ id: shoppingLists.id })
    if (!product || !room || !list) {
      throw new Error('не удалось подготовить данные списка')
    }
    await db
      .insert(shoppingListItems)
      .values({ listId: list.id, catalogItemId: product.id, roomId: room.id, quantity: 1 })

    await page.reload()
    const row = page.getByRole('listitem').filter({ hasText: 'Диван Букле e2e' })
    await expect(row).toBeVisible()
    await expect(row.getByText(/67\s900\s₽/)).toBeVisible()
    await expect(page.getByText(/1 позиция · 1 предмет/)).toBeVisible()

    await row.getByRole('button', { name: 'Больше на один' }).click()
    await expect(row.getByText(/135\s800\s₽/)).toBeVisible()
    await expect(estimate.getByText(/503\s800\s₽/)).toBeVisible()
    await expect(page.getByText(/1 позиция · 2 предмета/)).toBeVisible()

    await row.getByRole('button', { name: 'убрать' }).click()
    await expect(page.getByText('Список пока пуст.')).toBeVisible()
    await expect(estimate.getByText(/368\s000\s₽/)).toBeVisible()

    // Экспорт PDF: без ключа очереди кнопка честно говорит, что сборка не подключена,
    // с ключом запускает задачу и показывает шаги сборки
    const exportCard = page.getByRole('region', { name: 'Забрать проект' })
    await expect(exportCard.getByText('с водяным знаком «Домица»')).toBeVisible()
    await exportCard.getByRole('button', { name: 'Собрать PDF с водяным знаком' }).click()
    if (process.env.TRIGGER_SECRET_KEY) {
      await expect(exportCard.getByRole('list', { name: 'Сборка PDF' })).toBeVisible({
        timeout: 20_000,
      })
    } else {
      await expect(page.getByText('Сборка PDF пока не подключена')).toBeVisible()
    }
  })

  test('pays for the project through the payment provider and unlocks the clean PDF', async ({
    page,
  }) => {
    test.skip(
      Boolean(process.env.YUKASSA_SHOP_ID),
      'с настоящими ключами ЮKassa оплата уводит на внешнюю страницу',
    )
    await registerViaForm(page, uniqueEmail('payer'))
    await page.goto('/onboarding/step-1')
    await page.getByLabel('Название проекта').fill('Оплата проекта')
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
    const projectId = new URL(page.url()).searchParams.get('project') ?? ''

    await page.goto(`/projects/${projectId}/summary`)
    const exportCard = page.getByRole('region', { name: 'Забрать проект' })
    await expect(exportCard.getByText(/Разовая покупка проекта — 1\s500\s₽/)).toBeVisible()
    await exportCard.getByRole('button', { name: /Забрать за 1\s500\s₽/ }).click()
    await expect(page.getByText('Оплата прошла')).toBeVisible()
    await expect(
      exportCard.getByText('Проект оплачен, документ выходит без водяного знака.'),
    ).toBeVisible()

    // Второй проект в бесплатном плане закрыт: вместо «Новый проект» предложение Pro
    await page.goto('/projects')
    await expect(page.getByRole('link', { name: 'Новый проект' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Оформить Pro/ })).toBeVisible()
  })
})
