import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Интеграционные тесты ходят в локальную базу из docker-compose
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
})
