import { expect, test } from '@playwright/test'

const PASSWORD = 'lampa-u-okna-2026'
const ORIGIN = `http://localhost:${process.env.PORT ?? '3000'}`

// Однопиксельный PNG: достаточно, чтобы пройти проверку по магическим байтам и попасть в sharp
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function contextHeaders(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`, origin: ORIGIN }
}

test.describe('profile', () => {
  test.use({
    extraHTTPHeaders: contextHeaders(),
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  })

  test('renames the user and uploads an avatar to the bucket', async ({ page }) => {
    const email = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`

    await page.goto('/register')
    await page.getByLabel('Почта').fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Ещё раз').fill(PASSWORD)
    await page.getByLabel(/согласие/).check()
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page).toHaveURL(/\/verify-email/)

    await page.goto('/profile')
    await page.getByLabel('Имя').fill('Анна Горская')
    await page.route('**/profile', async (route) => {
      const request = route.request()
      if (request.method() === 'POST' && request.headers()['next-action']) {
        await route.abort('connectionfailed')
      } else {
        await route.continue()
      }
    })
    await page.getByRole('button', { name: 'Сохранить' }).tap()
    await expect(
      page.getByText(
        'Не удалось получить ответ сервера. Проверьте соединение и попробуйте сохранить ещё раз.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(page.getByLabel('Имя')).toHaveValue('Анна Горская')
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
    await page.unroute('**/profile')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Сохранили')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Имя')).toHaveValue('Анна Горская')

    const sizes = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1)

    await page.route('**/profile', async (route) => {
      const request = route.request()
      if (request.method() === 'POST' && request.headers()['next-action']) {
        await route.abort('connectionfailed')
      } else {
        await route.continue()
      }
    })
    await page.locator('#avatar').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    })
    await expect(page.getByText('Не удалось получить ответ сервера', { exact: true })).toBeVisible()
    await expect(page.locator('button').filter({ hasText: /^Загрузить фото$/ })).toBeEnabled()
    await expect(page.locator('#avatar')).toBeEnabled()
    await page.unroute('**/profile')

    await page.locator('#avatar').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    })
    await expect(page.getByText('Фото обновлено')).toBeVisible()
    await expect(page.locator('img[src*="avatars/"]')).toBeVisible()
    await page.reload()
    await expect(page.locator('img[src*="avatars/"]')).toBeVisible()

    const avatarUrl = await page.locator('img[src*="avatars/"]').getAttribute('src')
    expect(avatarUrl).toContain('X-Amz-Signature')
    const stored = await page.request.get(avatarUrl ?? '')
    expect(stored.status()).toBe(200)
    expect(stored.headers()['content-type']).toBe('image/webp')

    await page.locator('#avatar').setInputFiles({
      name: 'not-an-image.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('MZ this is an executable, honest'),
    })
    await expect(page.getByText('не похоже на JPG, PNG или WebP')).toBeVisible()
  })
})
