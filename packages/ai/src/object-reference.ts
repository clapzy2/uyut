/** Рамка на исходном фото, а не размеры предмета в комнате. */
import type { EditPlan } from './edit-plan'

export type SourceObject = {
  photoRevision: number
  box: { x: number; y: number; w: number; h: number }
}

/** Один образец нельзя выдавать за несколько разных переносимых предметов. */
export function sourceMovePlanIssue(plan: EditPlan): string | null {
  if (plan.warningRu) return plan.warningRu
  if (plan.steps.filter((step) => step.needsObject).length !== 1) {
    return 'Для одного выделения переносите один предмет за раз. Уточните просьбу в заметках.'
  }
  if (
    plan.steps.length > 4 ||
    plan.steps.some(
      (step) =>
        !step.titleRu.trim() ||
        step.titleRu.length > 200 ||
        !step.prompt.trim() ||
        step.prompt.length > 600,
    )
  ) {
    return 'Не удалось подготовить короткий план переноса. Упростите просьбу в заметках.'
  }
  return null
}

export function validSourceObject(value: unknown): value is SourceObject {
  if (!value || typeof value !== 'object') return false
  const { photoRevision, box } = value as SourceObject
  return (
    Number.isInteger(photoRevision) &&
    photoRevision >= 0 &&
    Boolean(box) &&
    [box.x, box.y, box.w, box.h].every(Number.isFinite) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.w >= 0.02 &&
    box.h >= 0.02 &&
    box.x + box.w <= 1 &&
    box.y + box.h <= 1
  )
}
