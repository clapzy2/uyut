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
}

describe('parseServerEnv', () => {
  it('accepts a complete environment and applies defaults', () => {
    const env = parseServerEnv(complete)
    expect(env.NODE_ENV).toBe('development')
    expect(env.SENTRY_DSN).toBeUndefined()
  })

  it('treats an empty SENTRY_DSN as not configured', () => {
    expect(parseServerEnv({ ...complete, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined()
  })

  it('names the broken variable in the error', () => {
    expect(() => parseServerEnv({ ...complete, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/)
  })

  it('rejects a missing required variable', () => {
    const { S3_BUCKET: _omitted, ...withoutBucket } = complete
    expect(() => parseServerEnv(withoutBucket)).toThrow(/S3_BUCKET/)
  })
})
