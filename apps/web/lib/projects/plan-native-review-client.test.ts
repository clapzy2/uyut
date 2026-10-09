import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { loadNativeReview } from './plan-native-review-client'
import { nativeReviewPacket } from './plan-native-review-packet'
import { inspectReviewedPageCoverage } from './plan-page-reviewed-coverage'

const body = 'private jpeg test bytes',
  imageHash = createHash('sha256').update(body).digest('hex'),
  revision = 'c'.repeat(64)
function fixture() {
  const packet = {
    ...nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: imageHash, page: 1, width: 1000, height: 1000 },
    }),
    sourceRevision: revision,
  }
  const headers = {
    'content-type': 'image/jpeg',
    'x-plan-sha256': packet.source.sha256,
    'x-plan-image-sha256': imageHash,
    'x-plan-page': '1',
    'x-plan-image-width': '1000',
    'x-plan-image-height': '1000',
  }
  return { packet, headers }
}
const input = () => ({
  projectId: 'private-project',
  page: 1,
  revision,
  signal: new AbortController().signal,
})
describe('atomic private native image/packet loading', () => {
  function coveredFixture() {
    const result = fixture()
    const polygon = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 100 },
    ]
    const { reviewSpans: _reviewSpans, ...coverage } = inspectReviewedPageCoverage({
      source: result.packet.source,
      reading: {
        readAt: '2026-10-09',
        sourcePage: 1,
        planState: 'existing',
        rooms: [{ sourceNumber: 1, name: 'Комната', kind: 'living' }],
      },
      contours: {
        source: result.packet.source,
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [{ roomSourceNumber: 1, polygon }],
      },
      linework: {
        coordinateSystem: 'page-0-1000',
        pageWidth: 1000,
        pageHeight: 1000,
        paths: [
          { operationIndex: 1, subpathIndex: 0, paint: 'stroke', closed: true, points: polygon },
        ],
        skippedCurves: 0,
        clippedPaths: 0,
        unsupportedPaths: 0,
        unsupportedContexts: 0,
        truncated: false,
      },
    })
    result.packet.savedReview = { status: 'checked', coverage }
    return { ...result, coverage }
  }
  it('returns saved review coverage only in the same verified private image pair', async () => {
    const { packet, headers } = coveredFixture()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    const result = await loadNativeReview(input(), fetcher as typeof fetch)
    expect(result.packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: { status: 'partial', readiness: { readyFor2D: false, readyFor3D: false } },
    })
  })
  it.each([
    'source',
    'page',
    'state',
    'promotion',
    'status',
    'counts',
    'spans',
    'floor-role',
    'issues',
    'missing',
    'null',
  ])('rejects malformed saved coverage %s before displaying source pixels', async (change) => {
    const { packet, headers, coverage } = coveredFixture()
    if (change === 'source') coverage.source.sha256 = 'd'.repeat(64)
    if (change === 'page') coverage.source.pdfPage = 2
    if (change === 'state') coverage.source.state = 'proposed' as 'existing'
    if (change === 'promotion') coverage.readiness.readyFor3D = true as false
    if (change === 'status') coverage.status = 'accepted' as 'partial'
    if (change === 'counts') coverage.openings.pairedDoorFaces = 1
    if (change === 'spans') Object.assign(coverage, { reviewSpans: [] })
    if (change === 'floor-role') coverage.floorBoundary = 'confirmed' as 'missing'
    if (change === 'issues') coverage.issues = ['x'.repeat(129)]
    if (change === 'missing') delete (packet as Partial<typeof packet>).savedReview
    if (change === 'null')
      packet.savedReview = { status: 'checked', coverage: null as unknown as typeof coverage }
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    await expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toMatchObject({
      status: 422,
    })
  })
  it('fetches both channels without saving, and checks actual private image bytes', async () => {
    const { packet, headers } = fixture()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    const result = await loadNativeReview(input(), fetcher as typeof fetch)
    expect(result.packet.image.sha256).toBe(imageHash)
    expect(await result.image.text()).toBe(body)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(
      fetcher.mock.calls.every(([url]) => url.includes('/api/projects/private-project/plan-page?')),
    ).toBe(true)
  })
  it.each(['pdf', 'image', 'page', 'width', 'bytes', 'revision', 'promotion', 'counts', 'polygon'])(
    'refuses mismatched or malformed %s response',
    (change) => {
      const { packet, headers } = fixture()
      if (change === 'pdf') headers['x-plan-sha256'] = 'd'.repeat(64)
      if (change === 'image') headers['x-plan-image-sha256'] = 'd'.repeat(64)
      if (change === 'page') headers['x-plan-page'] = '2'
      if (change === 'width') headers['x-plan-image-width'] = '999'
      if (change === 'revision') packet.sourceRevision = 'd'.repeat(64)
      if (change === 'promotion') packet.readiness.readyFor2D = true as false
      if (change === 'counts') packet.counts.strokeFaces = NaN
      if (change === 'polygon')
        packet.faces = [
          {
            id: 'bad',
            layer: 'stroke',
            annotationHint: false,
            polygon: [
              { x: -1, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ]
      const fetcher = vi.fn(async (url: string) =>
        url.includes('native-review-image')
          ? new Response(change === 'bytes' ? 'different bytes' : body, { headers })
          : Response.json(packet),
      )
      return expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toThrow()
    },
  )
  it('preserves a revision conflict as 409 and never presents a half-successful pair', async () => {
    const { packet } = fixture()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image')
        ? new Response('План изменился.', { status: 409 })
        : Response.json(packet),
    )
    await expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toMatchObject({
      status: 409,
    })
  })
  it('does not return an inspection after cancellation', async () => {
    const { packet, headers } = fixture(),
      controller = new AbortController()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    controller.abort()
    await expect(
      loadNativeReview({ ...input(), signal: controller.signal }, fetcher as typeof fetch),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
