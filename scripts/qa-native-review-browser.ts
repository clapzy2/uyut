// Local standalone client QA; Next route authorization is tested independently.
// bun --no-env-file run scripts/qa-native-review-browser.ts PDF PAGE PORT FRESH_DIRECTORY
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PlanReading } from '@uyut/db'
import { preparePlanPage } from '../apps/web/lib/projects/plan-document'
import { nativeReviewPacket } from '../apps/web/lib/projects/plan-native-review-packet'

const [pdfPath, pageArgument, portArgument, outputArgument, savedReadingPath] =
  process.argv.slice(2)
if (!pdfPath || !pageArgument || !portArgument || !outputArgument)
  throw new Error('Supply PDF, page, port and fresh directory')
const pageNumber = Number(pageArgument),
  port = Number(portArgument)
if (
  !Number.isSafeInteger(pageNumber) ||
  pageNumber < 1 ||
  !Number.isSafeInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error('Invalid QA page or port')
const directory = resolve(outputArgument)
await mkdir(directory, { recursive: false })
const body = await readFile(resolve(pdfPath)),
  sourceHash = createHash('sha256').update(body).digest('hex')
const page = await preparePlanPage(body, true, pageNumber, true, true)
const imageHash = createHash('sha256').update(page.image.body).digest('hex')
const savedReading = savedReadingPath
  ? (JSON.parse(await readFile(resolve(savedReadingPath), 'utf8')) as PlanReading)
  : undefined
const packet = {
  ...nativeReviewPacket({
    source: { sha256: sourceHash, pdfPage: pageNumber, state: 'existing' },
    image: {
      sha256: imageHash,
      page: pageNumber,
      width: page.image.width,
      height: page.image.height,
    },
    native: page.nativeTextAnchors,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
    savedReading,
  }),
  sourceRevision: 'c'.repeat(64),
}
const build = await Bun.build({
  entrypoints: ['./apps/web/scripts/qa-native-review-browser-entry.tsx'],
  outdir: join(directory, 'bundle'),
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"' },
})
if (!build.success) throw new Error(String(build.logs))
const chunks = resolve('apps/web/.next/static/chunks')
const styles = (await readdir(chunks)).filter((name) => name.endsWith('.css')).sort()
if (!styles.length) throw new Error('Build application CSS before browser QA')
const css = (await Promise.all(styles.map((name) => readFile(join(chunks, name), 'utf8')))).join(
  '\n',
)
const html = `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native review QA</title><link rel="stylesheet" href="/style.css"><style>body{font-family:Arial,sans-serif}h1{font-family:Georgia,serif}</style></head><body><div id="root" data-page="${pageNumber}"></div><script type="module" src="/client.js"></script></body></html>`
let inspectionRequests = 0,
  imageRequests = 0
const requests: { method: string; format: string | null; mode: string | null }[] = []
let mutations = 0
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/')
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    if (url.pathname === '/style.css')
      return new Response(css, { headers: { 'content-type': 'text/css' } })
    if (url.pathname === '/client.js')
      return new Response(
        Bun.file(join(directory, 'bundle', 'qa-native-review-browser-entry.js')),
        { headers: { 'content-type': 'application/javascript' } },
      )
    if (/^\/_next\/static\/media\/[a-zA-Z0-9._-]+$/.test(url.pathname))
      return new Response(
        Bun.file(join('apps/web/.next/static/media', url.pathname.split('/').at(-1) ?? '')),
      )
    if (url.pathname === '/qa-stats')
      return Response.json({
        inspectionRequests,
        imageRequests,
        mutations,
        paidRequests: 0,
        requests,
      })
    if (url.pathname !== '/api/projects/qa-native-review/plan-page')
      return new Response('Not found', { status: 404 })
    requests.push({
      method: request.method,
      format: url.searchParams.get('format'),
      mode: url.searchParams.get('qaMode'),
    })
    if (request.method !== 'GET') {
      mutations++
      return new Response('Read-only QA', { status: 405 })
    }
    const headers = {
      'cache-control': 'private, no-store',
      'x-plan-sha256': sourceHash,
      'x-plan-image-sha256': imageHash,
      'x-plan-page': String(pageNumber),
      'x-plan-image-width': String(page.image.width),
      'x-plan-image-height': String(page.image.height),
    }
    if (url.searchParams.get('qaMode') === 'unauthorized')
      return new Response('Сессия закончилась. Войдите снова.', { status: 401, headers })
    if (url.searchParams.get('revision') !== packet.sourceRevision)
      return new Response('План изменился. Загрузите актуальную версию.', { status: 409, headers })
    if (url.searchParams.get('qaMode') === 'delay') await Bun.sleep(1200)
    if (url.searchParams.get('format') === 'native-review-image') {
      imageRequests++
      if (url.searchParams.get('qaMode') === 'wrong-image')
        headers['x-plan-image-sha256'] = 'a'.repeat(64)
      return new Response(new Uint8Array(page.image.body), {
        headers: { ...headers, 'content-type': 'image/jpeg' },
      })
    }
    inspectionRequests++
    const result = structuredClone(packet)
    const mode = url.searchParams.get('qaMode')
    if (mode === 'no-review') result.savedReview = { status: 'not-saved' }
    if (mode === 'unavailable-review')
      result.savedReview = { status: 'unavailable', reason: 'native-layer-unavailable' }
    if (mode === 'stale-review' && result.savedReview.status === 'checked') {
      result.savedReview.coverage.status = 'refused'
      result.savedReview.coverage.refusalReason = 'different-plan-source'
    }
    if (mode === 'malformed-review' && result.savedReview.status === 'checked')
      result.savedReview.coverage.readiness.readyFor2D = true as false
    return Response.json(result, { headers })
  },
})
console.log(
  JSON.stringify({
    url: server.url.href,
    pid: process.pid,
    source: packet.source,
    counts: packet.counts,
    readOnly: true,
    mockedPrivateApi: true,
  }),
)
