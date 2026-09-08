import { defineConfig, devices } from '@playwright/test'

// Тот же PORT читает next start, поэтому тесты и сервер всегда на одном порту
const baseURL = `http://localhost:${process.env.PORT ?? '3000'}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Сборка боевая, ключей магазина нет: без явного разрешения приложение не стартует,
    // потому что в бою фейковая оплата означала бы раздачу проектов даром.
    env: { ALLOW_FAKE_PAYMENTS: '1' },
  },
})
