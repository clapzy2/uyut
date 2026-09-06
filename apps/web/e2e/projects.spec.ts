import { type Browser, expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'

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

// JPEG с EXIF-полями: после загрузки их не должно остаться
async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: '#d9ceb6' } })
    .jpeg()
    .withMetadata({
      exif: { IFD0: { Copyright: 'Uyut e2e', ImageDescription: 'plan with metadata' } },
    })
    .toBuffer()
}

test.describe
  .serial('projects', () => {
    test.use({ extraHTTPHeaders: contextHeaders() })

    let projectUrl = ''
    let roomUrl = ''

    test('owner creates a project, uploads a plan, adds rooms and a photo', async ({ page }) => {
      await registerViaForm(page, uniqueEmail('owner'))

      // Проект заводится через онбординг; здесь проверяем только первый его шаг
      await page.goto('/onboarding/step-1')
      await page.getByLabel('Название проекта').fill('Квартира на Ленина')
      await page.getByRole('button', { name: 'Убрать' }).last().click()
      await page.getByRole('button', { name: 'Дальше' }).click()
      await expect(page).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
      const projectId = new URL(page.url()).searchParams.get('project')
      await page.goto(`/projects/${projectId}`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Квартира на Ленина')
      await expect(page.getByText('Расскажите о себе')).toBeVisible()
      projectUrl = page.url()

      const source = await jpegWithExif()
      expect((await sharp(source).metadata()).exif).toBeDefined()
      await page
        .locator('#plan')
        .setInputFiles({ name: 'plan.jpg', mimeType: 'image/jpeg', buffer: source })
      await expect(page.getByText('План загружен')).toBeVisible()
      const plan = page.locator('img[src*="/plan/"]')
      await expect(plan).toBeVisible()

      const stored = await page.request.get((await plan.getAttribute('src')) ?? '')
      expect(stored.status()).toBe(200)
      expect(stored.headers()['content-type']).toBe('image/webp')
      const storedMeta = await sharp(await stored.body()).metadata()
      expect(storedMeta.exif).toBeUndefined()
      expect(storedMeta.width).toBe(640)

      await page.locator('#plan').setInputFiles({
        name: 'huge.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(20 * 1024 * 1024),
      })
      await expect(page.getByText('Файл весит 20 МБ, а можно до 15 МБ')).toBeVisible()

      await page.locator('#plan').setInputFiles({
        name: 'malware.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('MZ this is not an image at all'),
      })
      await expect(page.getByText('Это не похоже на PDF, JPG или PNG')).toBeVisible()

      for (const kind of ['Спальня']) {
        await page.getByRole('button', { name: 'Добавить комнату' }).click()
        // Радиокнопки скрыты визуально, кликаем по подписи-чипу внутри диалога
        await page.getByRole('dialog').getByText(kind, { exact: true }).click()
        await expect(page.getByLabel('Название')).toHaveValue(kind)
        await page.getByRole('button', { name: 'Добавить', exact: true }).click()
        await expect(page.getByText(`${kind}: комната добавлена`)).toBeVisible()
        await expect(page.getByRole('link', { name: new RegExp(kind) })).toBeVisible()
      }
      await expect(page.getByText('2 комнаты')).toBeVisible()

      await page.getByRole('link', { name: /Гостиная/ }).click()
      await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)
      roomUrl = page.url()

      const photo = await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: '#7c2f3b' },
      })
        .png()
        .toBuffer()
      await page
        .locator('#photo')
        .setInputFiles({ name: 'living.png', mimeType: 'image/png', buffer: photo })
      await expect(page.getByText('Фото загружено')).toBeVisible()
      const photoImage = page.locator('img[src*="/photo/"]')
      await expect(photoImage).toBeVisible()
      const storedPhoto = await page.request.get((await photoImage.getAttribute('src')) ?? '')
      expect((await sharp(await storedPhoto.body()).metadata()).width).toBe(2048)

      await page.getByLabel('Заметки').fill('Батарея под окном, дверь открывается внутрь.')
      await page.getByRole('button', { name: 'Сохранить' }).click()
      await expect(page.getByText('Сохранили')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Сгенерировать концепты' })).toBeEnabled()
    })

    test('a stranger sees neither the project nor the room', async ({
      browser,
    }: {
      browser: Browser
    }) => {
      const context = await browser.newContext({ extraHTTPHeaders: contextHeaders() })
      const page = await context.newPage()
      await registerViaForm(page, uniqueEmail('stranger'))

      await page.goto('/projects')
      await expect(page.getByRole('heading', { level: 1 })).toContainText('первый проект')
      await expect(page.getByText('Квартира на Ленина')).toHaveCount(0)

      await page.goto(projectUrl)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Такой страницы нет.')
      await page.goto(roomUrl)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Такой страницы нет.')
      await context.close()
    })
  })
