import { playwright } from '@trigger.dev/build/extensions/playwright'
import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  project: 'proj_uhdwfcktksmvrkwbvrbv',
  runtime: 'node-24',
  dirs: ['./src'],
  // sharp содержит нативные бинарники и не переживает бандлинг: ставим его в образ как есть.
  // Playwright печатает PDF: расширение ставит Chromium с зависимостями в образ воркера.
  build: {
    external: ['sharp', 'playwright', 'playwright-core'],
    extensions: [playwright({ browsers: ['chromium'] })],
  },
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
})
