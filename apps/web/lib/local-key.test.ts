import { describe, expect, it, vi } from 'vitest'
import { localKey } from './local-key'

describe('localKey', () => {
  it('выдаёт разные ключи', () => {
    const keys = new Set([localKey(), localKey(), localKey()])
    expect(keys.size).toBe(3)
  })

  it('учитывает приставку', () => {
    expect(localKey('room')).toMatch(/^room-\d+$/)
  })

  it('работает без crypto — ради этого всё и затевалось', () => {
    // По обычному HTTP браузер не даёт crypto.randomUUID, и код, который на него опирается,
    // роняет страницу целиком
    vi.stubGlobal('crypto', undefined)
    expect(() => localKey('room')).not.toThrow()
    vi.unstubAllGlobals()
  })
})
