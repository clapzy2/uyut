import { describe, expect, it } from 'vitest'
import { PLAN_MAX_BYTES } from './lib/files/rules'
import nextConfig from './next.config'

describe('multipart plan upload limits', () => {
  it('allows the complete plan and multipart envelope through proxy and server action', () => {
    const proxyLimit = nextConfig.experimental?.proxyClientMaxBodySize
    const actionLimit = nextConfig.experimental?.serverActions?.bodySizeLimit
    expect(proxyLimit).toBe('16mb')
    expect(actionLimit).toBe(proxyLimit)
    expect(16 * 1024 * 1024).toBeGreaterThan(PLAN_MAX_BYTES)
  })
})
