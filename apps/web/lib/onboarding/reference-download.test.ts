import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }))
vi.mock('node:http', () => ({ request: mocks.request }))
vi.mock('node:https', () => ({ request: mocks.request }))
vi.mock('node:dns', () => ({ lookup: mocks.lookup }))

import { fetchReferenceImage, isPublicAddress } from './reference-download'

function respond(type: string, chunks: Buffer[], status = 200, location?: string) {
  mocks.request.mockImplementationOnce((_url, _options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void }
    request.end = () => {
      const response = Readable.from(chunks)
      Object.assign(response, { statusCode: status, headers: { 'content-type': type, location } })
      queueMicrotask(() => callback(response))
    }
    return request
  })
}

beforeEach(() => vi.resetAllMocks())

describe('reference downloads', () => {
  it('handles malformed redirects delivered asynchronously', async () => {
    respond('text/html', [], 302, 'http://[invalid')
    expect(await fetchReferenceImage('https://public.example/image')).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])('blocks %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })
  it.each(['8.8.8.8', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })
  it('rejects non-HTTP and private literal URLs before connecting', async () => {
    for (const url of ['file:///etc/passwd', 'http://127.1/image', 'http://[::1]/']) {
      expect(await fetchReferenceImage(url)).toBeNull()
    }
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('checks redirect targets before connecting', async () => {
    respond('text/html', [], 302, 'http://169.254.169.254/latest/')
    expect(await fetchReferenceImage('https://public.example/image')).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('checks og:image targets before connecting', async () => {
    respond('text/html', [Buffer.from('<meta property="og:image" content="http://10.0.0.1/x">')])
    expect(await fetchReferenceImage('https://public.example/page')).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('rejects a private DNS answer at connection lookup', async () => {
    respond('image/png', [Buffer.from('image')])
    await fetchReferenceImage('https://public.example/image')
    const options = mocks.request.mock.calls[0]?.[1]
    mocks.lookup.mockImplementation((_host, _options, callback) => callback(null, '192.168.1.1', 4))
    const callback = vi.fn()
    options.lookup('public.example', {}, callback)
    expect(callback.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(options.agent).toBe(false)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it('stops an oversized chunked body without content-length', async () => {
    respond('image/png', [Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(6 * 1024 * 1024)])
    expect(await fetchReferenceImage('https://public.example/image')).toBeNull()
  })
  it('limits HTML before parsing', async () => {
    respond('text/html', [Buffer.alloc(200_001)])
    expect(await fetchReferenceImage('https://public.example/page')).toBeNull()
  })
  it('returns a bounded image', async () => {
    respond('image/png', [Buffer.from('image')])
    const image = await fetchReferenceImage('https://public.example/image')
    expect(image?.size).toBe(5)
  })
})
