import { expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'
import { extractLink, waitForEmail } from './helpers/mailpit'

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
    overflowing: Array.from(document.querySelectorAll('body *'))
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: element.textContent?.slice(0, 100),
      })),
  }))
  expect(
    sizes.scroll,
    `страница шире экрана: ${sizes.scroll} > ${sizes.client}; ${JSON.stringify(sizes.overflowing)}`,
  ).toBeLessThanOrEqual(sizes.client + 1)
}

test.describe('mobile critical path', () => {
  test.use({
    extraHTTPHeaders: contextHeaders(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test('new user completes onboarding, uploads a room photo and opens the summary on mobile', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Продумайте обстановку своей квартиры.',
    )
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

    const letter = await waitForEmail(email, { subjectIncludes: 'Подтвердите' })
    await page.goto(extractLink(letter.text, '/api/auth/verify-email'))
    await expect(page.getByText('Почта подтверждена')).toBeVisible()
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
    await page.getByText('Есть кот или собака', { exact: true }).click()
    await expect(switches.first()).toBeChecked()
    await page.getByRole('button', { name: 'Дальше' }).tap()
    await expect(page).toHaveURL(/\/onboarding\/step-3/)
    await expectFitsViewport(page)
    await page.getByRole('button', { name: 'Дальше' }).tap()
    await expect(page).toHaveURL(/\/onboarding\/step-4/)
    await expectFitsViewport(page)
    for (let index = 0; index < 10; index += 1) {
      await page.getByRole('button', { name: 'Нравится', exact: true }).tap()
    }
    await page.getByRole('button', { name: 'Дальше' }).tap()
    await expect(page).toHaveURL(/\/onboarding\/step-5/)
    await expectFitsViewport(page)
    const photo = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#65819a' },
    })
      .png()
      .toBuffer()
    await page.locator('#reference').setInputFiles({
      name: 'mobile-reference.png',
      mimeType: 'image/png',
      buffer: photo,
    })
    await expect(page.getByText('Картинка сохранена', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Готово', exact: true }).tap()
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    const projectUrl = page.url()
    await expectFitsViewport(page)
    await page.getByRole('link', { name: /Гостиная/ }).tap()
    await page.locator('#photo').setInputFiles({
      name: 'broken-photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not a real image'),
    })
    await expect(page.getByText('Файл не загрузился', { exact: true })).toBeVisible()
    await expect(page.locator('#photo')).toBeEnabled()
    await page.locator('#photo').setInputFiles({
      name: 'mobile-room.png',
      mimeType: 'image/png',
      buffer: photo,
    })
    await expect(page.getByText('Фото загружено')).toBeVisible()
    await page.reload()
    await expect(page.locator('img[src*="/photo/"]')).toBeVisible()
    // Abort before dispatch: neither the initial click nor the failed status check reaches a model.
    const roomUrl = page.url()
    let blockedGenerationRequests = 0
    await page.route(roomUrl, async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        blockedGenerationRequests += 1
        await route.abort('connectionfailed')
      } else {
        await route.continue()
      }
    })
    const generateButton = page.getByRole('button', { name: 'Сгенерировать концепты' })
    await generateButton.tap()
    await expect(
      page.getByText('Не удалось получить ответ о запуске.', { exact: false }),
    ).toBeVisible()
    await expect(generateButton).toHaveCount(0)
    const generationStatus = page.getByRole('button', { name: 'Проверить статус генерации' })
    await generationStatus.tap()
    await expect(page.getByText('Не удалось проверить результат.', { exact: false })).toBeVisible()
    await expect(generationStatus).toBeEnabled()
    expect(blockedGenerationRequests).toBe(2)
    await page.unroute(roomUrl)
    await generationStatus.tap()
    await expect(generateButton).toBeEnabled()
    await page.reload()
    await expect(generateButton).toBeEnabled()
    await expectFitsViewport(page)
    await page.goto(projectUrl)
    await page.getByRole('link', { name: 'Список покупок и смета' }).tap()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Итоги проекта')
    await expect(page.getByText('Список пока пуст.')).toBeVisible()
    await expectFitsViewport(page)
    const exportButton = page.getByRole('button', {
      name: 'Бесплатно собрать PDF с водяным знаком',
    })
    await expect(exportButton).toBeVisible()
    const summaryUrl = page.url()
    let blockedPdfRequests = 0
    await page.route(summaryUrl, async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        blockedPdfRequests += 1
        await route.abort('connectionfailed')
      } else {
        await route.continue()
      }
    })
    await exportButton.tap()
    await expect(
      page.getByText('Не удалось получить ответ о запуске PDF.', { exact: false }),
    ).toBeVisible()
    await expect(exportButton).toHaveCount(0)
    const pdfStatus = page.getByRole('button', { name: 'Проверить статус PDF' })
    await pdfStatus.tap()
    await expect(page.getByText('Не удалось проверить PDF.', { exact: false })).toBeVisible()
    await expect(pdfStatus).toBeEnabled()
    expect(blockedPdfRequests).toBe(2)
    await page.unroute(summaryUrl)
    await pdfStatus.tap()
    await expect(exportButton).toBeEnabled()
    // Queue-enabled environments may incur external work; only exercise the local error state.
    if (!process.env.TRIGGER_SECRET_KEY) {
      await exportButton.tap()
      await expect(page.getByText('Сборка PDF пока не подключена')).toBeVisible()
    }
    await page.setViewportSize({ width: 320, height: 844 })
    await expectFitsViewport(page)
    const headerControls = page.getByRole('banner').locator('a:visible, button:visible')
    for (const control of await headerControls.all()) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(box?.x).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 320) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
    }
  })
})
