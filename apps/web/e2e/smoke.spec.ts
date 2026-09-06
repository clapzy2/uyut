import { expect, test } from '@playwright/test'

test('home page sends a guest to the login screen', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('С возвращением.')
})

test('health check reports the database', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' })
})
