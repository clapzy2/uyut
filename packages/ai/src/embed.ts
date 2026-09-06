import { type StyleEntry, styleLibrary } from './styles'
import type { Embedder, EmbedInput } from './types'

// Та же длина, что у колонки style_reference_embedding в базе (packages/db/src/schema/embedding.ts).
export const EMBEDDING_DIMENSIONS = 1024

/**
 * Вектор вкуса без внешних сервисов. Каждому стилю библиотеки отдана своя координата,
 * лайки складываются и нормируются, остаток дополняется нулями до длины колонки.
 * Дополнение нулями не меняет косинусную близость, поэтому такие векторы сравнимы между собой.
 */
export function styleVector(likedStyleIds: readonly string[]): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  let hits = 0
  for (const id of likedStyleIds) {
    const index = styleLibrary.findIndex((entry) => entry.id === id)
    if (index >= 0) {
      vector[index] = (vector[index] ?? 0) + 1
      hits += 1
    }
  }
  if (hits === 0) {
    return vector
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return vector.map((value) => value / length)
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    dot += left * right
    normA += left * left
    normB += right * right
  }
  if (normA === 0 || normB === 0) {
    return 0
  }
  return dot / Math.sqrt(normA * normB)
}

/** Ближайшие стили к вектору вкуса: первый становится ведущим, остальные уточняют промпт. */
export function nearestStyles(vector: readonly number[], count = 3): StyleEntry[] {
  return styleLibrary
    .map((entry, index) => ({ entry, weight: vector[index] ?? 0 }))
    .filter((item) => item.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, count)
    .map((item) => item.entry)
}

/** Семейства стилей по вектору, в порядке убывания веса. Пишутся в projects.style_tags. */
export function styleTagsFromVector(vector: readonly number[]): string[] {
  const weights = new Map<string, number>()
  styleLibrary.forEach((entry, index) => {
    const weight = vector[index] ?? 0
    if (weight > 0) {
      weights.set(entry.family, (weights.get(entry.family) ?? 0) + weight)
    }
  })
  return [...weights.entries()].sort((left, right) => right[1] - left[1]).map(([family]) => family)
}

type VoyageResponse = { data?: Array<{ embedding?: number[] }> }

/**
 * Voyage Multimodal 3. Нужен для матчинга каталога в следующей фазе; здесь заводится сразу,
 * чтобы ключ подключался в одном месте. Без ключа сервис не используется.
 */
export function createVoyageEmbedder(
  apiKey: string,
  options: { model?: string; timeoutMs?: number } = {},
): Embedder {
  const model = options.model ?? 'voyage-multimodal-3'
  const timeoutMs = options.timeoutMs ?? 30_000
  return {
    name: model,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(inputs: EmbedInput[]): Promise<number[][]> {
      const body = {
        model,
        inputs: inputs.map((input) => ({
          content: [
            ...(input.text ? [{ type: 'text', text: input.text }] : []),
            ...(input.image
              ? [
                  {
                    type: 'image_base64',
                    image_base64: `data:${input.image.contentType};base64,${input.image.body.toString('base64')}`,
                  },
                ]
              : []),
          ],
        })),
      }
      const response = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        throw new Error(`voyage: ${response.status} ${(await response.text()).slice(0, 200)}`)
      }
      const payload = (await response.json()) as VoyageResponse
      return (payload.data ?? []).map((item) => item.embedding ?? [])
    },
  }
}
