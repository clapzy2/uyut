import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { SecondaryStorage } from 'better-auth'
import { getEnv } from './env'

let redis: Redis | undefined
let rawRedis: Redis | undefined

export function getRedis(): Redis {
  if (!redis) {
    const env = getEnv()
    redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
  }
  return redis
}

// Better Auth хранит уже сериализованные строки, поэтому клиент без автоматического JSON
function getRawRedis(): Redis {
  if (!rawRedis) {
    const env = getEnv()
    rawRedis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      automaticDeserialization: false,
    })
  }
  return rawRedis
}

// Кэш сессий и счётчики встроенного rate limit Better Auth
export function createAuthStorage(): SecondaryStorage {
  const prefix = 'auth:'
  return {
    get: async (key) => {
      const value = await getRawRedis().get<string>(prefix + key)
      return value ?? null
    },
    set: async (key, value, ttl) => {
      if (ttl) {
        await getRawRedis().set(prefix + key, value, { ex: ttl })
      } else {
        await getRawRedis().set(prefix + key, value)
      }
    },
    delete: async (key) => {
      await getRawRedis().del(prefix + key)
    },
    getAndDelete: async (key) => {
      const value = await getRawRedis().getdel<string>(prefix + key)
      return value ?? null
    },
    increment: async (key, ttl) => {
      const count = await getRawRedis().incr(prefix + key)
      if (count === 1 && ttl) {
        await getRawRedis().expire(prefix + key, ttl)
      }
      return count
    },
  }
}

let loginByEmailLimiter: Ratelimit | undefined
let requestsByIpLimiter: Ratelimit | undefined

// Десять попыток входа в час на один адрес, независимо от IP
export function getLoginByEmailLimiter(): Ratelimit {
  loginByEmailLimiter ??= new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix: 'rl:login-email',
  })
  return loginByEmailLimiter
}

// Общий потолок на IP для всего приложения
export function getRequestsByIpLimiter(): Ratelimit {
  requestsByIpLimiter ??= new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(300, '1 m'),
    prefix: 'rl:ip',
  })
  return requestsByIpLimiter
}
