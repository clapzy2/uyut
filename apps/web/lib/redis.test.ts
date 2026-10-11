import { errors } from '@upstash/redis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  getdel: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
}))

vi.mock('@upstash/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@upstash/redis')>()
  return {
    ...actual,
    Redis: class {
      get = mocks.get
      set = mocks.set
      del = mocks.del
      getdel = mocks.getdel
      incr = mocks.incr
      expire = mocks.expire
    },
  }
})
vi.mock('./env', () => ({
  getEnv: () => ({
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
  }),
}))

import { createAuthStorage } from './redis'

beforeEach(() => vi.resetAllMocks())

describe('auth secondary storage empty response retry', () => {
  it.each(['serialized session', null])(
    'returns a successful GET without retry: %s',
    async (value) => {
      mocks.get.mockResolvedValueOnce(value)
      expect(await createAuthStorage().get('test-session')).toBe(value)
      expect(mocks.get).toHaveBeenCalledExactlyOnceWith('auth:test-session')
    },
  )

  it.each(['serialized session', null])(
    'retries an empty body once and returns %s',
    async (value) => {
      mocks.get
        .mockRejectedValueOnce(new errors.UpstashJSONParseError(''))
        .mockResolvedValueOnce(value)
      expect(await createAuthStorage().get('test-session')).toBe(value)
      expect(mocks.get).toHaveBeenCalledTimes(2)
      expect(mocks.get).toHaveBeenNthCalledWith(1, 'auth:test-session')
      expect(mocks.get).toHaveBeenNthCalledWith(2, 'auth:test-session')
    },
  )

  it('propagates the second empty response rather than returning a cache miss', async () => {
    const error = new errors.UpstashJSONParseError('')
    mocks.get.mockRejectedValue(error)
    await expect(createAuthStorage().get('test-session')).rejects.toBe(error)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('propagates a different failure after the retry', async () => {
    const error = new Error('fetch failed')
    mocks.get
      .mockRejectedValueOnce(new errors.UpstashJSONParseError(''))
      .mockRejectedValueOnce(error)
    await expect(createAuthStorage().get('test-session')).rejects.toBe(error)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it.each([
    new errors.UpstashJSONParseError('<html>unavailable</html>'),
    new errors.UpstashJSONParseError(' '),
    new errors.UpstashError('command failed'),
    new Error('fetch failed'),
    Object.assign(new Error('Unable to parse response body: '), { name: 'UpstashJSONParseError' }),
  ])('does not retry other errors: %s', async (error) => {
    mocks.get.mockRejectedValueOnce(error)
    await expect(createAuthStorage().get('test-session')).rejects.toBe(error)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('does not retry or swallow write, delete, consume or increment failures', async () => {
    const error = new errors.UpstashJSONParseError('')
    for (const operation of [mocks.set, mocks.del, mocks.getdel, mocks.incr]) {
      operation.mockRejectedValueOnce(error)
    }
    const storage = createAuthStorage()
    await expect(storage.set('test-session', 'value', 60)).rejects.toBe(error)
    await expect(storage.delete('test-session')).rejects.toBe(error)
    await expect(storage.getAndDelete?.('verification:test')).rejects.toBe(error)
    await expect(storage.increment?.('rate-limit:test', 60)).rejects.toBe(error)
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith('auth:test-session', 'value', { ex: 60 })
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith('auth:test-session')
    expect(mocks.getdel).toHaveBeenCalledExactlyOnceWith('auth:verification:test')
    expect(mocks.incr).toHaveBeenCalledExactlyOnceWith('auth:rate-limit:test')
    expect(mocks.expire).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
