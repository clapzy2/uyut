import { describe, expect, it } from 'vitest'
import { resolveClientIp } from './client-ip'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('client ip behind a reverse proxy', () => {
  it('takes the address the proxy appended, not the one the client sent', () => {
    const forged = headers({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })
    expect(resolveClientIp(forged, 1)).toBe('203.0.113.7')
  })

  it('counts entries from the end by the number of proxies in front', () => {
    const chain = headers({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7, 198.51.100.2' })
    expect(resolveClientIp(chain, 2)).toBe('203.0.113.7')
    expect(resolveClientIp(chain, 3)).toBe('9.9.9.9')
  })

  it('trusts nothing when the app faces the internet directly', () => {
    expect(resolveClientIp(headers({ 'x-forwarded-for': '9.9.9.9' }), 0)).toBeNull()
    expect(resolveClientIp(headers({ 'x-real-ip': '9.9.9.9' }), 0)).toBeNull()
  })

  it('falls back to x-real-ip when the chain is shorter than expected', () => {
    const short = headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.2' })
    expect(resolveClientIp(short, 2)).toBe('198.51.100.2')
    expect(resolveClientIp(headers({ 'x-real-ip': '198.51.100.2' }), 1)).toBe('198.51.100.2')
  })

  it('reports nothing when no proxy header arrived at all', () => {
    expect(resolveClientIp(headers({}), 1)).toBeNull()
    expect(resolveClientIp(headers({ 'x-forwarded-for': ' , ' }), 1)).toBeNull()
  })
})
