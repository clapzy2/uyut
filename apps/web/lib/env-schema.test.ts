import { describe, expect, it } from 'vitest'
import { parseServerEnv } from './env-schema'

const complete = {
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://uyut:uyut@localhost:5432/uyut',
  UPSTASH_REDIS_REST_URL: 'http://localhost:8079',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'ru-1',
  S3_BUCKET: 'uyut-dev',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'Домица <hello@domitsa.local>',
}

describe('parseServerEnv', () => {
  it('accepts a complete environment and applies defaults', () => {
    const env = parseServerEnv(complete)
    expect(env.NODE_ENV).toBe('development')
    expect(env.SENTRY_DSN).toBeUndefined()
    expect(env.SENTRY_ENVIRONMENT).toBeUndefined()
    expect(env.MAILPIT_URL).toBeUndefined()
    // Развёртывание идёт за одним обратным прокси, так что доверяем последней записи
    expect(env.TRUSTED_PROXY_HOPS).toBe(1)
  })

  it('rejects a proxy count that is not a whole number of hops', () => {
    expect(() => parseServerEnv({ ...complete, TRUSTED_PROXY_HOPS: '-1' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    )
    expect(parseServerEnv({ ...complete, TRUSTED_PROXY_HOPS: '0' }).TRUSTED_PROXY_HOPS).toBe(0)
  })

  it('treats an empty SENTRY_DSN as not configured', () => {
    expect(parseServerEnv({ ...complete, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined()
  })

  it('keeps an explicit Sentry environment separate from NODE_ENV', () => {
    expect(
      parseServerEnv({ ...complete, NODE_ENV: 'production', SENTRY_ENVIRONMENT: 'local-e2e' })
        .SENTRY_ENVIRONMENT,
    ).toBe('local-e2e')
  })

  it('names the broken variable in the error', () => {
    expect(() => parseServerEnv({ ...complete, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/)
  })

  it('rejects a missing required variable', () => {
    const { S3_BUCKET: _omitted, ...withoutBucket } = complete
    expect(() => parseServerEnv(withoutBucket)).toThrow(/S3_BUCKET/)
  })

  it('rejects a short auth secret', () => {
    expect(() => parseServerEnv({ ...complete, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    )
  })
})
