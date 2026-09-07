import { randomUUID } from 'node:crypto'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { concepts, createDb, projects, rooms } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { extractLink, waitForEmail } from './helpers/mailpit'

const PASSWORD = 'lampa-u-okna-2026'
const PARTNER_PASSWORD = 'vtoroy-uchastnik-2026'
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

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/projects/)
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: contextHeaders(), baseURL: ORIGIN })
}

/**
 * Два окна на одном проекте: владелец приглашает, второй участник входит по ссылке из письма,
 * оба отмечают концепты и видят отметки друг друга, вкладка «Общие» показывает совпадение,
 * а при десяти оценках без совпадений появляется предложение вариантов на двоих.
 * Рендеров в CI нет, поэтому концепты сажаем в базу.
 */
test.describe('together', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  const ownerEmail = uniqueEmail('owner')
  const partnerEmail = uniqueEmail('partner')
  let projectId = ''
  let roomId = ''

  test.afterAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url || !projectId) {
      return
    }
    const db = createDb(url)
    await db.delete(projects).where(eq(projects.id, projectId))
  })

  test('owner invites, partner joins by the letter and sees a limited project', async ({
    browser,
  }) => {
    const owner = await newContext(browser)
    const ownerPage = await owner.newPage()
    await registerViaForm(ownerPage, ownerEmail)
    await ownerPage.goto('/onboarding/step-1')
    await ownerPage.getByLabel('Название проекта').fill('Квартира вдвоём')
    await ownerPage.getByRole('button', { name: 'Дальше' }).click()
    await expect(ownerPage).toHaveURL(/\/onboarding\/step-2\?project=[0-9a-f-]{36}/)
    projectId = new URL(ownerPage.url()).searchParams.get('project') ?? ''

    // Приглашения доступны в оплаченном проекте: платим не через провайдера, а сразу в базе,
    // и туда же сажаем десять готовых концептов гостиной
    const db = createDb(process.env.DATABASE_URL as string)
    await db.update(projects).set({ isPaid: true }).where(eq(projects.id, projectId))
    const [room] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.projectId, projectId))
      .limit(1)
    roomId = room?.id ?? ''
    expect(roomId).not.toBe('')
    const batchId = randomUUID()
    await db.insert(concepts).values(
      Array.from({ length: 10 }, (_, index) => ({
        roomId,
        batchId,
        orderIndex: index,
        status: 'ready' as const,
        prompt: `e2e concept ${index + 1}`,
        aiModel: 'e2e',
        renderUrl: `projects/${projectId}/rooms/${roomId}/concepts/e2e-${index + 1}.webp`,
      })),
    )

    await ownerPage.goto(`/projects/${projectId}`)
    await ownerPage.getByRole('button', { name: 'Выбирать вдвоём' }).click()
    await ownerPage.getByLabel('Почта').fill(partnerEmail)
    await ownerPage.getByRole('button', { name: 'Отправить приглашение' }).click()
    await expect(ownerPage.getByText('Приглашение отправлено').first()).toBeVisible()
    await expect(ownerPage.getByText(`Приглашение отправлено на ${partnerEmail}`)).toBeVisible()

    const letter = await waitForEmail(partnerEmail, { subjectIncludes: 'зовёт вас' })
    const link = extractLink(letter.text, '/magic-link/verify')

    const partner = await newContext(browser)
    const partnerPage = await partner.newPage()
    await partnerPage.goto(link)
    await expect(partnerPage).toHaveURL(/\/invites\//)
    await expect(partnerPage.getByRole('heading', { level: 1 })).toContainText('ждёт вас')
    await partnerPage.getByLabel('Пароль', { exact: true }).fill(PARTNER_PASSWORD)
    await partnerPage.getByLabel('Ещё раз').fill(PARTNER_PASSWORD)
    await partnerPage.getByRole('button', { name: 'Открыть проект' }).click()
    await expect(partnerPage).toHaveURL(new RegExp(`/projects/${projectId}$`))
    await expect(partnerPage.getByText(/Вы в проекте/)).toBeVisible()
    await expect(partnerPage.getByText('Удалить проект')).toHaveCount(0)
    await expect(partnerPage.getByRole('button', { name: 'Настроить' })).toHaveCount(0)

    await partnerPage.goto(`/projects/${projectId}/summary`)
    await expect(partnerPage.getByText(/Забрать за/)).toHaveCount(0)
    await expect(partnerPage.getByText(/оплачивает проект владелец/)).toBeVisible()

    // Владельцу пришло письмо о том, что второй участник в проекте
    const joined = await waitForEmail(ownerEmail, { subjectIncludes: 'теперь в проекте' })
    expect(joined.text).toContain('Квартира вдвоём')

    await ownerPage.reload()
    await expect(ownerPage.getByText('Отозвать доступ')).toBeVisible()
    await owner.close()
    await partner.close()
  })

  test('likes of one side appear on the other within seconds', async ({ browser }) => {
    const owner = await newContext(browser)
    const partner = await newContext(browser)
    const ownerPage = await owner.newPage()
    const partnerPage = await partner.newPage()
    await login(ownerPage, ownerEmail, PASSWORD)
    await login(partnerPage, partnerEmail, PARTNER_PASSWORD)
    const roomUrl = `/projects/${projectId}/rooms/${roomId}`
    await ownerPage.goto(roomUrl)
    await partnerPage.goto(roomUrl)

    await expect(ownerPage.getByText(/онлайн · в этой комнате/)).toBeVisible({ timeout: 15_000 })
    await expect(partnerPage.getByText(/онлайн · в этой комнате/)).toBeVisible({
      timeout: 15_000,
    })

    // Владелец отмечает «нравится» десять карточек, второй участник — «не нравится»
    for (let index = 0; index < 10; index += 1) {
      await ownerPage.getByRole('button', { name: 'Нравится', exact: true }).click()
      await partnerPage.getByRole('button', { name: 'Не нравится', exact: true }).click()
      await ownerPage.waitForTimeout(150)
    }
    await expect(ownerPage.getByText(/Только что/)).toBeVisible({ timeout: 10_000 })
    await expect(partnerPage.getByText(/Только что/)).toBeVisible({ timeout: 10_000 })
    await expect(ownerPage.getByRole('tab', { name: /^Мои 10/ })).toBeVisible({ timeout: 10_000 })
    await expect(partnerPage.getByRole('tab', { name: /10$/ }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(ownerPage.getByRole('tab', { name: /^Общие 0/ })).toBeVisible()

    // Десять оценок у каждого без единого совпадения: предложение вариантов на двоих у обоих
    await expect(ownerPage.getByText('Варианты на двоих')).toBeVisible({ timeout: 10_000 })
    await expect(partnerPage.getByText('Варианты на двоих')).toBeVisible({ timeout: 10_000 })
    await expect(partnerPage.getByRole('button', { name: /Сгенерировать три/ })).toHaveCount(0)

    // Второй участник передумал на странице концепта: совпадение появляется у владельца
    await partnerPage.goto(`${roomUrl}/concepts/${await firstConceptId(roomId)}`)
    await partnerPage.getByRole('button', { name: '♥ Нравится' }).click()
    await expect(ownerPage.getByRole('tab', { name: /^Общие 1/ })).toBeVisible({ timeout: 10_000 })
    await expect(ownerPage.getByText('Варианты на двоих')).toHaveCount(0)
    await owner.close()
    await partner.close()
  })
})

async function firstConceptId(roomId: string): Promise<string> {
  const db = createDb(process.env.DATABASE_URL as string)
  const [row] = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.roomId, roomId))
    .orderBy(concepts.orderIndex)
    .limit(1)
  return row?.id ?? ''
}
