import { architectureAnchoredPrompt } from './prompt'
import type { ConceptRenderer, RenderRequest, RenderResult } from './types'

export type ArchitectureBatchItem = Pick<RenderRequest, 'prompt' | 'seed' | 'aspectRatio'>

export type ArchitectureBatchPlan = {
  /** Первый text-to-image результат; тот же Promise стоит первым в results. */
  anchor: Promise<RenderResult>
  /** По одному результату на item, в исходном порядке. */
  results: Array<Promise<RenderResult>>
}

/**
 * Рисует первый вариант с нуля, а остальные — от него как от визуального якоря.
 *
 * Отказ якоря не повторяет первый платный запрос: только остальные варианты возвращаются к
 * самостоятельной генерации. Отказ edit-запроса тоже не приводит к скрытому повтору.
 */
export function renderArchitectureAnchoredBatch(
  engine: ConceptRenderer,
  items: [ArchitectureBatchItem, ...ArchitectureBatchItem[]],
): ArchitectureBatchPlan {
  const [first, ...rest] = items
  const anchor = engine.render(first)
  const results = [
    anchor,
    ...rest.map((item) =>
      anchor.then(
        (result) =>
          engine.render({
            ...item,
            prompt: architectureAnchoredPrompt(item.prompt),
            imageUrl: `data:${result.contentType};base64,${result.body.toString('base64')}`,
          }),
        () => engine.render(item),
      ),
    ),
  ]
  return { anchor, results }
}
