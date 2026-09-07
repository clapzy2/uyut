import { expect, test } from '@playwright/test'

test('home page shows the landing and leads a guest to registration', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Проект квартиры за вечер')
  await expect(page.getByRole('link', { name: 'Пользовательское соглашение' })).toBeVisible()
  await page.getByRole('link', { name: 'Начать бесплатно' }).click()
  await expect(page).toHaveURL(/\/register/)
})

test('legal documents open from the footer', async ({ page }) => {
  await page.goto('/legal/offer')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Публичная оферта')
  await expect(page.getByText('Автоматическое продление можно отключить')).toBeVisible()
})

test('health check reports the database', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' })
})
