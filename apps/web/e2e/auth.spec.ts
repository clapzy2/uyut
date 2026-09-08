import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { extractLink, waitForEmail } from './helpers/mailpit'

const PASSWORD = 'lampa-u-okna-2026'
const ORIGIN = `http://localhost:${process.env.PORT ?? '3000'}`

function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
}

// Лимиты считаются по IP, поэтому каждый сценарий и каждый прогон приходят со «своего» адреса.
// Origin нужен API-запросам: POST с cookie и без Origin сервер отклоняет как возможный CSRF.
function contextHeaders(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`, origin: ORIGIN }
}

async function signUpViaApi(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post('/api/auth/sign-up/email', {
    data: { email, password: PASSWORD, name: email.split('@')[0] },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  // Регистрация сразу открывает сессию; дальше сценарий должен идти как гость
  await request.post('/api/auth/sign-out')
}

async function signInViaForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

test.describe('registration and verification', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  test('register, confirm email from the letter, sign out and sign in again', async ({ page }) => {
    const email = uniqueEmail('reg')

    await page.goto('/register')
    await page.getByLabel('Почта').fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Ещё раз').fill(PASSWORD)
    await page.getByLabel(/согласие/).check()
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()

    await expect(page).toHaveURL(/\/verify-email/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Проверьте почту')

    const letter = await waitForEmail(email, { subjectIncludes: 'Подтвердите' })
    await page.goto(extractLink(letter.text, '/api/auth/verify-email'))
    await expect(page).toHaveURL(/\/profile/)
    await expect(page.getByText('Почта подтверждена')).toBeVisible()

    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(/\/login/)

    await signInViaForm(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/projects/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('первый проект')
  })
})

test.describe('wrong password', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  test('explains the problem under the form without revealing which field is wrong', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('wrong')
    await signUpViaApi(request, email)

    await signInViaForm(page, email, 'not-the-password')
    await expect(page.getByText('Почта или пароль не подходят')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('password reset', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  test('sends a letter, accepts a new password and signs in with it', async ({ page, request }) => {
    const email = uniqueEmail('reset')
    await signUpViaApi(request, email)

    await page.goto('/forgot-password')
    await page.getByLabel('Почта').fill(email)
    await page.getByRole('button', { name: 'Отправить ссылку' }).click()
    await expect(page.getByText('письмо уже ушло')).toBeVisible()

    const letter = await waitForEmail(email, { subjectIncludes: 'Смена пароля' })
    await page.goto(extractLink(letter.text, '/api/auth/reset-password/'))
    await expect(page).toHaveURL(/\/reset-password\?token=/)

    const newPassword = 'novyj-parol-2026'
    await page.getByLabel('Новый пароль').fill(newPassword)
    await page.getByLabel('Ещё раз').fill(newPassword)
    await page.getByRole('button', { name: 'Сохранить и войти' }).click()
    await expect(page).toHaveURL(/\/login/)

    await signInViaForm(page, email, newPassword)
    await expect(page).toHaveURL(/\/projects/)
  })
})

test.describe('rate limits', () => {
  test.use({ extraHTTPHeaders: contextHeaders() })

  test('blocks the sixth login attempt within a minute and the fourth registration within an hour', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('limit')
    await signUpViaApi(request, email)

    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request.post('/api/auth/sign-in/email', {
        data: { email, password: 'wrong-password' },
      })
      statuses.push(response.status())
    }
    // Первые пять отклонены как неверный пароль, шестая упирается в лимит
    expect(
      statuses.slice(0, 5).every((status) => status >= 400 && status < 429),
      `statuses: ${statuses.join(', ')}`,
    ).toBeTruthy()
    expect(statuses[5], `statuses: ${statuses.join(', ')}`).toBe(429)

    await signInViaForm(page, email, PASSWORD)
    await expect(page.getByText('Слишком много попыток')).toBeVisible()

    const registrations: number[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request.post('/api/auth/sign-up/email', {
        data: { email: uniqueEmail('limit-reg'), password: PASSWORD, name: 'limit' },
      })
      registrations.push(response.status())
      await request.post('/api/auth/sign-out')
    }
    // Одна регистрация уже была в начале сценария, поэтому 429 приходит на третьей из этих трёх
    expect(registrations, `registrations: ${registrations.join(', ')}`).toEqual([200, 200, 429])
  })
})
