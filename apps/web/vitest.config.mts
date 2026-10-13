import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Next preserves JSX for its compiler; component tests need the automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    // The PDF/geometry fixtures are CPU-heavy; unconstrained file workers can
    // starve individual tests enough to hit the 5-second timeout on CI.
    maxWorkers: 4,
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**', '**/*.integration.test.ts'],
  },
})
