import { expect, test } from '@playwright/test'

test('home page renders the greeting', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, Uyut')
})

test('health check reports the database', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' })
})
