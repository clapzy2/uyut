import { describe, expect, it } from 'vitest'
import { pdfRasterPreview } from './plan-pdf-raster-preview'

function previewResponse(patch: Record<string, string> = {}, body: BlobPart = 'jpeg bytes') {
  return new Response(new Blob([body]), {
    headers: {
      'content-type': 'image/jpeg',
      'X-Plan-Sha256': 'a'.repeat(64),
      'X-Plan-Page': '2',
      'X-Plan-Image-Width': '1000',
      'X-Plan-Image-Height': '800',
      ...patch,
    },
  })
}

describe('private PDF raster preview response', () => {
  it('returns the bounded image and source identity', async () => {
    const result = await pdfRasterPreview(previewResponse(), 2)
    expect(result).toMatchObject({ sha256: 'a'.repeat(64), page: 2, width: 1000, height: 800 })
    expect(result.blob.type).toBe('image/jpeg')
    expect(result.blob.size).toBe(10)
  })

  it.each<Record<string, string>>([
    { 'X-Plan-Sha256': '' },
    { 'X-Plan-Sha256': 'not-a-hash' },
    { 'X-Plan-Page': '1' },
    { 'X-Plan-Image-Width': '99' },
    { 'X-Plan-Image-Width': '2001' },
    { 'X-Plan-Image-Width': '100.5' },
    { 'X-Plan-Image-Height': '0' },
    { 'X-Plan-Image-Height': '2001' },
    { 'X-Plan-Image-Height': 'NaN' },
    { 'content-type': 'application/pdf' },
  ])('rejects mismatched or malformed metadata %j', async (patch) => {
    await expect(pdfRasterPreview(previewResponse(patch), 2)).rejects.toThrow('PDF-листу')
  })

  it.each([new Uint8Array(0), new Uint8Array(10_000_001)])(
    'rejects empty or oversized image data',
    async (body) => {
      await expect(pdfRasterPreview(previewResponse({}, body), 2)).rejects.toThrow('слишком велико')
    },
  )

  it('preserves a bounded error from the private endpoint', async () => {
    await expect(
      pdfRasterPreview(new Response('Нет доступа к листу', { status: 403 }), 2),
    ).rejects.toThrow('Нет доступа к листу')
  })
})
