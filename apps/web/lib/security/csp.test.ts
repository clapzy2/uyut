import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, createNonce } from './csp'

const local = { dev: true, secure: false, storageOrigin: 'http://localhost:9000' }
const production = { dev: false, secure: true, storageOrigin: 'https://s3.storage.example' }

function directive(policy: string, name: string): string {
  const found = policy.split('; ').find((part) => part.startsWith(`${name} `))
  if (!found) {
    throw new Error(`в политике нет директивы ${name}`)
  }
  return found
}

describe('content security policy', () => {
  it('gives every response its own nonce', () => {
    const first = createNonce()
    const second = createNonce()
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(atob(first)).toHaveLength(16)
  })

  it('allows scripts only by nonce and what they load themselves', () => {
    const policy = contentSecurityPolicy('abc123', production)
    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    )
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'")
  })

  it('refuses framing and raises the protocol on a secure site', () => {
    const policy = contentSecurityPolicy('abc123', production)
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(policy.endsWith('upgrade-insecure-requests')).toBe(true)
  })

  it('lets the file storage through by its own address', () => {
    expect(directive(contentSecurityPolicy('n', local), 'img-src')).toContain(
      'http://localhost:9000',
    )
    // По http сайт отдаётся только локально, поднимать протокол картинкам там нечему
    expect(contentSecurityPolicy('n', local)).not.toContain('upgrade-insecure-requests')
    // Адрес хранилища на https уже покрыт общим https:, второй раз его писать незачем
    expect(directive(contentSecurityPolicy('n', production), 'img-src')).toBe(
      "img-src 'self' data: blob: https: https://s3.storage.example",
    )
  })

  it('opens eval and websockets only for the dev server', () => {
    const dev = contentSecurityPolicy('abc123', local)
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'")
    expect(directive(dev, 'connect-src')).toContain('ws:')
    expect(directive(contentSecurityPolicy('abc123', production), 'connect-src')).not.toContain(
      'ws:',
    )
  })
})
