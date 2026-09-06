import path from 'node:path'
import { withSentryConfig } from '@sentry/nextjs/config'
import type { NextConfig } from 'next'

// Конфиг может исполняться и как CommonJS, и как ESM: берём то, что доступно
const configDir = typeof __dirname === 'undefined' ? process.cwd() : __dirname

const nextConfig: NextConfig = {
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(configDir, '../..'),
  transpilePackages: ['@uyut/db'],
  poweredByHeader: false,
  reactStrictMode: true,
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
