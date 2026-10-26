import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { pdfImageFromSources } from '../../../../jobs/src/lib/pdf-data'

afterEach(() => vi.restoreAllMocks())

it('uses the next product image when the first source cannot be read', async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer()
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) =>
      String(input).endsWith('/shop.jpg')
        ? new Response(new Uint8Array(jpeg), { status: 200 })
        : new Response(null, { status: 404 }),
    )

  const image = await pdfImageFromSources(
    ['https://partner.example/missing.jpg', 'https://shop.example/shop.jpg'],
    200,
  )

  expect(image?.src.startsWith('data:image/jpeg;base64,')).toBe(true)
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    'https://partner.example/missing.jpg',
    'https://shop.example/shop.jpg',
  ])
})

it('does not invent an image when every source is unavailable', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
  expect(await pdfImageFromSources(['https://partner.example/missing.jpg'], 200)).toBeNull()
})
