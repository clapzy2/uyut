import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { loadNativeReview } from './plan-native-review-client'
import { nativeReviewPacket } from './plan-native-review-packet'

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
