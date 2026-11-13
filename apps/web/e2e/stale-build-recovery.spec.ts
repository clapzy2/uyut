import { expect, test } from '@playwright/test'

test('retry replaces stale JavaScript without repeating an action', async ({ page }) => {
  const errors: string[] = []
  const writes: string[] = []
  const documents: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') {
      documents.push(request.url())
    }
    if (
      request.method() === 'POST' &&
      new URL(request.url()).origin === new URL(page.url()).origin
    ) {
      writes.push(request.url())
    }
  })

  await page.goto('/login')
  await expect(page.getByLabel('Почта')).toBeVisible()
  // Exercise the manual fallback even when the automatic reload was already used.
  await page.evaluate(() => {
    sessionStorage.setItem('uyut:stale-build-reload', String(Date.now()))
  })
  let blockedChunks = 0
  await page.route('**/_next/static/chunks/*.js', async (route) => {
    blockedChunks += 1
    await route.abort('failed')
  })
  await page
    .locator('#main-content')
    .getByRole('link', { name: 'Создать аккаунт', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Попробовать снова', exact: true })).toBeVisible()
  expect(blockedChunks).toBeGreaterThan(0)
  expect(errors.some((message) => /chunk/i.test(message))).toBe(true)

  await page.unroute('**/_next/static/chunks/*.js')
  const failedUrl = page.url()
  const previousDocuments = documents.length
  expect(previousDocuments).toBe(1)
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click()
  await expect(page.getByLabel('Ещё раз')).toBeVisible()
  await expect(page).toHaveURL(failedUrl)
  expect(documents.length).toBe(previousDocuments + 1)
  expect(writes).toEqual([])
})
