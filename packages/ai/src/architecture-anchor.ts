import { architectureAnchoredPrompt } from './prompt'
import type { ConceptRenderer, RenderRequest, RenderResult } from './types'

export type ArchitectureBatchItem = Pick<RenderRequest, 'prompt' | 'seed' | 'aspectRatio'>

export type ArchitectureAnchorEligibility = (result: RenderResult) => Promise<boolean>

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
 * Если задана проверка якоря, производные варианты ждут её результата. Отклонённый или
 * непроверенный кадр остаётся первым результатом, но не используется как образец.
 */
export function renderArchitectureAnchoredBatch(
  engine: ConceptRenderer,
  items: [ArchitectureBatchItem, ...ArchitectureBatchItem[]],
  isAnchorEligible?: ArchitectureAnchorEligibility,
): ArchitectureBatchPlan {
  const [first, ...rest] = items
  const anchor = engine.render(first)
  const eligibleAnchor = anchor
    .then(async (result) => {
      if (isAnchorEligible && !(await isAnchorEligible(result))) return null
      return result
    })
    .catch(() => null)
  const results = [
    anchor,
    ...rest.map((item) =>
      eligibleAnchor.then((result) => {
        if (!result) return engine.render(item)
        return engine.render({
          ...item,
          prompt: architectureAnchoredPrompt(item.prompt),
          imageUrl: `data:${result.contentType};base64,${result.body.toString('base64')}`,
        })
      }),
    ),
  ]
  return { anchor, results }
}
