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

test.describe('assistant', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  test('drawer opens on the project page, answers and keeps history', async ({ page }) => {
    await registerViaForm(page, uniqueEmail('chat'))

    await page.goto('/onboarding/step-1')
    await page.getByLabel('Название проекта').fill('Квартира с помощником')
    await page.getByRole('button', { name: 'Дальше' }).click()
    await expect(page).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
    const projectId = new URL(page.url()).searchParams.get('project')
    await page.goto(`/projects/${projectId}`)

    await page.getByRole('button', { name: 'Открыть помощника' }).click()
    const dialog = page.getByRole('dialog', { name: 'Помощник' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Я помощник Uyut')).toBeVisible()
    // Пока панель открыта, страница под ней не прокручивается: второй полосы рядом с панелью нет
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .toBe('hidden')
    // Фокус остаётся внутри панели
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))))
      .toBe(true)

    await page.getByLabel('Сообщение помощнику').fill('С чего начать?')
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(dialog.getByText('С чего начать?')).toBeVisible()
    // Без ключа модели приходит честное «не подключён», с ключом — настоящий ответ; в обоих случаях не пусто
    const reply = dialog.locator('li').nth(1)
    await expect(reply).not.toHaveText('', { timeout: 30_000 })
    await expect
      .poll(async () => (await reply.innerText()).trim().length, { timeout: 30_000 })
      .toBeGreaterThan(20)

    // История переживает перезагрузку страницы
    await page.reload()
    await page.getByRole('button', { name: 'Открыть помощника' }).click()
    const reopened = page.getByRole('dialog', { name: 'Помощник' })
    await expect(reopened.getByText('С чего начать?')).toBeVisible()

    // Escape закрывает панель, и прокрутка страницы возвращается
    await page.keyboard.press('Escape')
    await expect(reopened).toBeHidden()
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .not.toBe('hidden')
  })
})
