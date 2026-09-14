import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Next preserves JSX for its compiler; component tests need the automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**', '**/*.integration.test.ts'],
  },
})
