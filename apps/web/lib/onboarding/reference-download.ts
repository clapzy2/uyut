import { lookup } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('3fff::', 20, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

function checkedUrl(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (isIP(host) && !isPublicAddress(host))
  ) {
    throw new Error('Reference URL is not public HTTP(S)')
  }
  return url
}

/** Resolve inside the connection lookup so DNS cannot change between validation and dialing. */
async function download(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{
  body: Buffer
  type: string
  url: URL
}> {
  const url = checkedUrl(value)
  if (redirects > 5) throw new Error('Too many redirects')
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(
      url,
      {
        signal,
        agent: false,
        family: isIP(url.hostname.replace(/^\[|\]$/g, '')) === 6 ? 6 : 4,
        headers: { 'user-agent': 'DomitsaBot/1.0', 'accept-encoding': 'identity' },
        lookup(hostname, options, callback) {
          lookup(hostname, { family: options.family === 6 ? 6 : 4 }, (error, address, family) => {
            if (error) return callback(error, address, family)
            if (!isPublicAddress(address))
              return callback(new Error('Private reference address'), '', 4)
            callback(null, address, family)
          })
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy()
          try {
            const target = new URL(response.headers.location, url)
            resolve(download(target.href, signal, redirects + 1))
          } catch (error) {
            reject(error)
          }
          return
        }
        const type = (response.headers['content-type'] ?? '').toLowerCase()
        const limit = type.startsWith('image/') ? 10 * 1024 * 1024 : 200_000
        if (
          status < 200 ||
          status >= 300 ||
          (!type.startsWith('image/') && !type.includes('text/html'))
        ) {
          response.destroy()
          reject(new Error('Unsupported reference response'))
          return
        }
        if (Number(response.headers['content-length']) > limit) {
          response.destroy()
          reject(new Error('Reference exceeds limit'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > limit) {
            response.destroy(new Error('Reference exceeds limit'))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => resolve({ body: Buffer.concat(chunks), type, url }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

export async function fetchReferenceImage(value: string): Promise<File | null> {
  const signal = AbortSignal.timeout(8000)
  try {
    let result = await download(value, signal)
    if (!result.type.startsWith('image/')) {
      const html = result.body.toString('utf8')
      const match =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      if (!match?.[1]) return null
      result = await download(new URL(match[1], result.url).href, signal)
    }
    if (!result.type.startsWith('image/') || result.body.length === 0) return null
    return new File([new Uint8Array(result.body)], 'reference', { type: result.type })
  } catch {
    return null
  }
}
