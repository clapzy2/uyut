import { expect, type Page, test } from '@playwright/test'

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
  await page.getByLabel(/согласие/).check()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/verify-email/)
}

test.describe('onboarding', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  test('a new user walks all five steps and lands on the project', async ({ page }) => {
    await registerViaForm(page, uniqueEmail('onboarding'))

    await page.goto('/projects')
    await page.getByRole('link', { name: 'Создать проект' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-1/)

    // Шаг 1: комнаты вручную, две штуки по умолчанию
    await page.getByLabel('Название проекта').fill('Квартира на Мира')
    await page.getByLabel('Площадь, м²').first().fill('18')
    await page.getByRole('button', { name: 'Дальше' }).click()

    // Шаг 2: состав семьи
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
    await page.getByText('Есть кот или собака').click()
    await page.getByRole('button', { name: 'Дальше' }).click()

    // Шаг 3: бюджет
    await expect(page).toHaveURL(/\/onboarding\/step-3/)
    await expect(page.getByText('₽')).toBeVisible()
    await page.getByRole('button', { name: 'Дальше' }).click()

    // Шаг 4: вкус, десять карточек хватает
    await expect(page).toHaveURL(/\/onboarding\/step-4/)
    const like = page.getByRole('button', { name: 'Нравится', exact: true })
    const skip = page.getByRole('button', { name: 'Не нравится' })
    for (let index = 0; index < 10; index += 1) {
      await (index % 2 === 0 ? like : skip).click()
    }
    await expect(page.getByText('понравилось 5')).toBeVisible()
    await page.getByRole('button', { name: 'Дальше' }).click()

    // Шаг 5: референс необязателен
    await expect(page).toHaveURL(/\/onboarding\/step-5/)
    await page.getByRole('button', { name: 'Пропустить этот шаг' }).click()

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Квартира на Мира')
    await expect(page.getByText('Расскажите о себе')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Гостиная/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Кухня/ })).toBeVisible()

    // На комнате кнопка генерации активна
    await page.getByRole('link', { name: /Гостиная/ }).click()
    await expect(page.getByRole('button', { name: 'Сгенерировать концепты' })).toBeEnabled()
  })
})
