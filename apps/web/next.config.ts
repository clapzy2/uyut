import path from 'node:path'
import { withSentryConfig } from '@sentry/nextjs/config'
import type { NextConfig } from 'next'

// Конфиг может исполняться и как CommonJS, и как ESM: берём то, что доступно
const configDir = typeof __dirname === 'undefined' ? process.cwd() : __dirname

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(configDir, '../..'),
  transpilePackages: ['@uyut/db', '@uyut/ui'],
  // Нативные модули не бандлятся, а грузятся из node_modules
  serverExternalPackages: ['@napi-rs/canvas', '@node-rs/argon2', 'pdfjs-dist', 'sharp'],
  // Стандартные шрифты pdf.js подгружаются по пути во время работы, и трассировщик их не видит.
  // Без них файлы, которые ссылаются на стандартные четырнадцать шрифтов и не вкладывают их,
  // рисуются чем попало.
  outputFileTracingIncludes: {
    '/projects/[id]': ['../../node_modules/.bun/**/pdfjs-dist/standard_fonts/*'],
    '/onboarding/step-1': ['../../node_modules/.bun/**/pdfjs-dist/standard_fonts/*'],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  // next dev иначе подкладывает в проект служебные md-файлы для сторонних инструментов
  agentRules: false,
  // Планы до 15 МБ приходят через Server Action одним запросом
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
