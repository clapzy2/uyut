import type { ConceptModelId } from '@uyut/ai'
import { layoutRoom } from '@uyut/catalog'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareConceptLayoutGuide } from '../../../../jobs/src/lib/concept-layout-guide'

const mocks = vi.hoisted(() => ({ layoutGuideSvgs: vi.fn() }))
vi.mock('@uyut/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@uyut/catalog')>()),
  layoutGuideSvgs: mocks.layoutGuideSvgs,
}))

const input = {
  layout: layoutRoom({ widthCm: 480, depthCm: 560 }, []),
  ceilingCm: undefined,
  modelId: 'gpt-image-2.5-sunburst' as ConceptModelId,
  hasSourceImage: false,
  hasBaseConcept: false,
  hasEditSteps: false,
  preserving: false,
}

describe('concept layout guide preparation', () => {
  beforeEach(() => {
    mocks.layoutGuideSvgs.mockReset().mockReturnValue({
      perspective:
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="red"/></svg>',
      plan: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32"><rect width="24" height="32" fill="blue"/></svg>',
    })
  })

  it.each([
    { name: 'no checked layout', change: { layout: undefined } },
    { name: 'room photo', change: { hasSourceImage: true } },
    { name: 'base concept edit', change: { hasBaseConcept: true } },
    { name: 'step edit', change: { hasEditSteps: true } },
    { name: 'preserved room', change: { preserving: true } },
    { name: 'single-image model', change: { modelId: 'kontext-pro' as const } },
  ])('leaves $name requests untouched', async ({ change }) => {
    expect(await prepareConceptLayoutGuide({ ...input, ...change })).toBeUndefined()
    expect(mocks.layoutGuideSvgs).not.toHaveBeenCalled()
  })

  it.each(['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'nano-banana-2', 'nano-banana-pro'] as const)(
    'prepares one ordered PNG pair for %s without assuming image indices',
    async (modelId) => {
      const result = await prepareConceptLayoutGuide({ ...input, modelId })
      expect(mocks.layoutGuideSvgs).toHaveBeenCalledExactlyOnceWith(input.layout, undefined)
      expect(result?.referenceUrls).toHaveLength(2)
      for (const [index, url] of (result?.referenceUrls ?? []).entries()) {
        expect(url).toMatch(/^data:image\/png;base64,/)
        const metadata = await sharp(Buffer.from(url.split(',')[1] ?? '', 'base64')).metadata()
        expect(metadata).toMatchObject({
          format: 'png',
          width: index === 0 ? 32 : 24,
          height: index === 0 ? 24 : 32,
        })
      }
      expect(result?.prompt).toContain('photorealistic interior image is also supplied')
      expect(result?.prompt).not.toMatch(/image [123]/i)
    },
  )

  it('omits guides when the diagram builder cannot represent the checked layout', async () => {
    mocks.layoutGuideSvgs.mockReturnValue(undefined)
    expect(await prepareConceptLayoutGuide(input)).toBeUndefined()
  })

  it('rejects unreadable diagrams so the job can retain its existing rendering path', async () => {
    mocks.layoutGuideSvgs.mockReturnValue({ perspective: 'not an SVG', plan: 'not an SVG' })
    await expect(prepareConceptLayoutGuide(input)).rejects.toThrow()
  })
})
