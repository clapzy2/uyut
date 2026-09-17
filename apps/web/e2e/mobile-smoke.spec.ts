import { expect, type Page, test } from '@playwright/test'

const PASSWORD = 'lampa-u-okna-2026'
const ORIGIN = `http://localhost:${process.env.PORT ?? '3000'}`

function contextHeaders(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`, origin: ORIGIN }
}

async function expectFitsViewport(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(
    sizes.scroll,
    `страница шире экрана: ${sizes.scroll} > ${sizes.client}`,
  ).toBeLessThanOrEqual(sizes.client + 1)
}

test.describe('mobile critical path', () => {
  test.use({
    extraHTTPHeaders: contextHeaders(),
    viewport: { width: 390, height: 844 },
  })

  test('landing, registration and household settings fit a phone viewport', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Проект квартиры за вечер')
    await expectFitsViewport(page)

    await page.getByRole('link', { name: 'Начать бесплатно' }).click()
    await expect(page).toHaveURL(/\/register/)
    await expectFitsViewport(page)

    const email = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
    await page.getByLabel('Почта').fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Ещё раз').fill(PASSWORD)
    await page.getByLabel(/согласие/).check()
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page).toHaveURL(/\/verify-email/)
    await expectFitsViewport(page)

    await page.goto('/onboarding/step-1')
    await page.getByLabel('Название проекта').fill('Мобильная квартира')
    await expectFitsViewport(page)
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=/)
    await expectFitsViewport(page)

    const switches = page.getByRole('checkbox')
    await expect(switches).toHaveCount(4)
    for (let index = 0; index < 4; index += 1) {
      const box = await switches.nth(index).locator('xpath=..').boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
    await switches.first().click()
    await expect(switches.first()).toBeChecked()
  })
})
