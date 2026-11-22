import { type ConceptRenderer, editStepPrompt, type RenderResult } from '@uyut/ai'

/** Исходный предмет прикладывается только при установке, не при удалении. */
export async function renderEditSteps(
  engine: ConceptRenderer,
  steps: Array<{ prompt: string; needsObject?: boolean }>,
  imageUrl: string | undefined,
  referenceUrls: string[],
  aspectRatio: string,
  editRequest?: string,
): Promise<RenderResult> {
  const usesObject = steps.some((step) => step.needsObject)
  if (usesObject && referenceUrls.length === 0) {
    throw new Error('Для переноса нужен образец исходного предмета. Выделите его на фото.')
  }
  let current = imageUrl
  let last: RenderResult | null = null
  // У переноса подготовленные шаги уже содержат связанные с ними ограничения.
  // Полный запрос содержал и будущую установку, которую модель выполняла при удалении стульев.
  const requestContext = usesObject && steps.length > 1 ? undefined : editRequest
  for (const step of steps) {
    const withObject = step.needsObject === true
    last = await engine.render({
      prompt: [
        editStepPrompt(step.prompt, requestContext),
        steps.length > 1
          ? 'Execute only the current step. Preserve the changes already made and do not infer or perform any further changes.'
          : '',
        withObject
          ? 'Image 1 is the current room. Image 2 is the original furniture reference, not a style suggestion. Reuse its design: preserve the cabinet divisions, drawer and door arrangement, handle count, orientation, material and proportions. Change only its position and perspective; do not replace it with similar furniture.'
          : '',
      ].join(' '),
      imageUrl: current,
      ...(withObject ? { referenceUrls } : {}),
      aspectRatio,
    })
    current = `data:${last.contentType};base64,${last.body.toString('base64')}`
  }
  if (!last) throw new Error('план правки пуст')
  return last
}
