import { downloadFalFile, FalError, falQueue } from './fal-queue'
import type { ConceptRenderer, RenderRequest, RenderResult } from './types'

// Движки генерации. Выбор проверен на реальной комнате: Nano Banana 2 держит геометрию и лучше
// понимает инструкции, Kontext Pro точнее в мелочах и дешевле, поэтому стоит запасным.
export const conceptModels = {
  'nano-banana-2': {
    label: 'Nano Banana 2',
    editEndpoint: 'fal-ai/nano-banana-2/edit',
    createEndpoint: 'fal-ai/nano-banana-2',
    supportsSeed: false,
    usdPerImage: 0.08,
  },
  'kontext-pro': {
    label: 'Flux Kontext Pro',
    editEndpoint: 'fal-ai/flux-pro/kontext',
    createEndpoint: 'fal-ai/flux-pro/v1.1',
    supportsSeed: true,
    usdPerImage: 0.04,
  },
} as const

export type ConceptModelId = keyof typeof conceptModels

export const conceptModelIds = Object.keys(conceptModels) as ConceptModelId[]

export function isConceptModelId(value: string): value is ConceptModelId {
  return value in conceptModels
}

export class RenderError extends FalError {
  constructor(message: string) {
    super(message)
    this.name = 'RenderError'
  }
}

function firstImageUrl(result: Record<string, unknown>): string | null {
  const images = result.images as Array<{ url?: string }> | undefined
  if (images?.[0]?.url) {
    return images[0].url
  }
  const image = result.image as { url?: string } | undefined
  return image?.url ?? null
}

function buildBody(
  modelId: ConceptModelId,
  request: RenderRequest,
): { endpoint: string; body: Record<string, unknown> } {
  const model = conceptModels[modelId]
  const aspectRatio = request.aspectRatio ?? '16:9'
  const seed = model.supportsSeed && request.seed !== undefined ? { seed: request.seed } : {}
  if (request.imageUrl) {
    if (modelId === 'nano-banana-2') {
      return {
        endpoint: model.editEndpoint,
        body: { image_urls: [request.imageUrl], prompt: request.prompt, aspect_ratio: aspectRatio },
      }
    }
    return {
      endpoint: model.editEndpoint,
      body: { image_url: request.imageUrl, prompt: request.prompt, guidance_scale: 3.5, ...seed },
    }
  }
  if (modelId === 'nano-banana-2') {
    return {
      endpoint: model.createEndpoint,
      body: { prompt: request.prompt, aspect_ratio: aspectRatio },
    }
  }
  return {
    endpoint: model.createEndpoint,
    body: { prompt: request.prompt, image_size: 'landscape_16_9', ...seed },
  }
}

export function createFalRenderer(
  apiKey: string,
  modelId: ConceptModelId,
  options: { timeoutMs?: number } = {},
): ConceptRenderer {
  const timeoutMs = options.timeoutMs ?? 180_000
  return {
    model: modelId,
    async render(request: RenderRequest): Promise<RenderResult> {
      const { endpoint, body } = buildBody(modelId, request)
      let result: Record<string, unknown>
      try {
        result = await falQueue(apiKey, endpoint, body, timeoutMs)
      } catch (error) {
        throw new RenderError(error instanceof Error ? error.message : String(error))
      }
      const url = firstImageUrl(result)
      if (!url) {
        throw new RenderError(`${endpoint}: в ответе нет картинки`)
      }
      const file = await downloadFalFile(url)
      return {
        body: file.body,
        contentType:
          file.contentType === 'application/octet-stream' ? 'image/jpeg' : file.contentType,
        model: modelId,
        seed: conceptModels[modelId].supportsSeed ? (request.seed ?? null) : null,
      }
    },
  }
}

// Подмена для тестов и CI: настоящих денег не тратит, отдаёт заранее заготовленную картинку
export function createSampleRenderer(
  load: (index: number) => Promise<{ body: Buffer; contentType: string }>,
): ConceptRenderer {
  let calls = 0
  return {
    model: 'sample',
    async render(): Promise<RenderResult> {
      const sample = await load(calls++)
      return { ...sample, model: 'sample', seed: null }
    },
  }
}
