import type { NormalizedBox } from './detect'
import { downloadFalFile, FalError, falQueue, toDataUri } from './fal-queue'

export type Segmenter = {
  /** Маска предмета внутри рамки: PNG того же размера, что картинка, белое — предмет. */
  maskForBox(
    image: { body: Buffer; contentType: string; width: number; height: number },
    bbox: NormalizedBox,
  ): Promise<{ body: Buffer; contentType: string }>
}

type Sam2Response = { image?: { url?: string } }

/**
 * SAM 2 на fal режет по рамке детектора. Точки внутри рамки для тонких предметов вроде торшера
 * попадали в стену за ними, а рамка удерживает маску на самом предмете.
 */
export function createFalSegmenter(
  apiKey: string,
  options: { timeoutMs?: number } = {},
): Segmenter {
  const timeoutMs = options.timeoutMs ?? 60_000
  return {
    async maskForBox(image, bbox) {
      const box = {
        x_min: Math.round(bbox.x * image.width),
        y_min: Math.round(bbox.y * image.height),
        x_max: Math.round((bbox.x + bbox.w) * image.width),
        y_max: Math.round((bbox.y + bbox.h) * image.height),
      }
      const response = await falQueue<Sam2Response>(
        apiKey,
        'fal-ai/sam2/image',
        { image_url: toDataUri(image), box_prompts: [box] },
        timeoutMs,
      )
      const url = response.image?.url
      if (!url) {
        throw new FalError('SAM 2 вернул ответ без маски')
      }
      return downloadFalFile(url)
    },
  }
}
