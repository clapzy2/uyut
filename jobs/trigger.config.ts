import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  project: 'proj_uhdwfcktksmvrkwbvrbv',
  runtime: 'node-24',
  dirs: ['./src'],
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
