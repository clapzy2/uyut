import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getChatByUserLimiter } from '@/lib/redis'

// Настоящий Redis из docker-compose: шестьдесят сообщений в час проходят, шестьдесят первое нет
describe('chat rate limit', () => {
  it('пропускает шестьдесят сообщений и останавливает шестьдесят первое', async () => {
    const limiter = getChatByUserLimiter()
    const userId = `limit-test-${randomUUID()}`
    let allowed = 0
    for (let index = 0; index < 60; index += 1) {
      const { success } = await limiter.limit(userId)
      if (success) {
        allowed += 1
      }
    }
    expect(allowed).toBe(60)
    const { success } = await limiter.limit(userId)
    expect(success).toBe(false)
  })
})
