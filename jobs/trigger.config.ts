import type { BuildExtension } from '@trigger.dev/build'
import { defineConfig } from '@trigger.dev/sdk'

/** Должна совпадать с playwright в зависимостях: браузер и библиотека ходят парой */
const PLAYWRIGHT_VERSION = '1.63.0'
const BROWSERS_PATH = '/ms-playwright'

/**
 * Ставит Chromium в образ воркера — им печатается PDF.
 *
 * Своё вместо готового playwright() из @trigger.dev/build: то расширение экономит на размере
 * образа, разбирая вывод `playwright install --dry-run` и выкачивая только нужный браузер.
 * Приём хрупкий. В Playwright 1.63 формат вывода изменился — вместо «browser: chromium-headless-shell»
 * печатается «Chrome Headless Shell … (playwright chromium-headless-shell v1243)», — и сборка
 * падала на grep, который ничего не находил.
 *
 * Здесь браузер ставится штатной командой самого Playwright. Образ выходит больше, потому что
 * скачиваются обе сборки Chromium, зато перестаёт зависеть от формата чужого вывода.
 */
function playwrightChromium(): BuildExtension {
  return {
    name: 'playwright-chromium',
    onBuildComplete(context) {
      if (context.target === 'dev') {
        return
      }
      context.addLayer({
        id: 'playwright',
        image: {
          instructions: [
            'RUN apt-get update && apt-get install -y --no-install-recommends npm \\\n  && apt-get clean && rm -rf /var/lib/apt/lists/*',
            // Каталог задаём и при установке, и в рантайме: иначе браузер ляжет в кэш root,
            // а искать его будут в другом месте
            `RUN PLAYWRIGHT_BROWSERS_PATH=${BROWSERS_PATH} npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium`,
            // Переменные вшиты в образ, а не заданы через deploy.env с override.
            // Тот вариант молча заменял собой весь набор переменных окружения воркера,
            // и он поднимался без адреса базы и ключей: задачи копились в очереди,
            // потому что брать их было некому.
            `ENV PLAYWRIGHT_BROWSERS_PATH=${BROWSERS_PATH}`,
            'ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1',
            'ENV PLAYWRIGHT_SKIP_BROWSER_VALIDATION=1',
          ],
        },
      })
    },
  }
}

export default defineConfig({
  project: 'proj_uhdwfcktksmvrkwbvrbv',
  runtime: 'node-24',
  dirs: ['./src'],
  // sharp содержит нативные бинарники и не переживает бандлинг: ставим его в образ как есть.
  // Пакеты шрифтов — по той же причине, только наоборот: код из них не нужен вовсе, нужны
  // файлы .woff2, а сборщик упаковывает только код и выбрасывает всё остальное. Из-за этого
  // сборка PDF падала на «Cannot find module .../literata-cyrillic-wght-normal.woff2».
  build: {
    external: [
      'sharp',
      'playwright',
      'playwright-core',
      '@fontsource-variable/literata',
      '@fontsource-variable/onest',
      '@fontsource/jetbrains-mono',
    ],
    extensions: [playwrightChromium()],
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
