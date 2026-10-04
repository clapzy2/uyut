import type { ConceptQualityReview } from '@uyut/db'
import type { QualityPlanStatus } from '@/lib/concepts/plan-review'

export function QualityReview({
  review,
  edited,
  planStatus,
  canComparePlan = true,
}: {
  review: ConceptQualityReview | null
  edited: boolean
  planStatus?: QualityPlanStatus | null
  canComparePlan?: boolean
}) {
  if (edited) {
    return (
      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
        Цвета обновлены; новая автосверка не выполнялась. Сверьте детали с исходным концептом.
      </p>
    )
  }
  if (!review || review.status === 'unavailable') {
    return (
      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
        {review
          ? 'Автосверка сейчас недоступна. Сверьте окна и двери с исходным планом или фото.'
          : 'Автосверка не выполнялась. Сверьте окна и двери с исходным планом или фото.'}
      </p>
    )
  }
  const planNeedsComparison = planStatus === 'changed' || planStatus === 'unlinked'
  const comparisonInstructions = canComparePlan
    ? 'Сравните окна, двери и контур в разделе «Сверить концепт с планом».'
    : 'Сверьте окна, двери и контур с исходным планом или фото комнаты.'
  const issues =
    planStatus === 'changed'
      ? review.issues.filter((issue) => issue.code !== 'opening_conflict')
      : review.issues
  return (
    <div className="mt-4 border border-line bg-paper p-4 text-[14px] leading-relaxed text-ink-2">
      <p className="font-medium text-ink">
        {issues.length > 0
          ? 'Автосверка: посмотрите отмеченные детали'
          : 'Автосверка изображения выполнена'}
      </p>
      {planNeedsComparison ? (
        <p className="mt-2 text-ink">
          {planStatus === 'changed'
            ? 'После правки плана нужна сверка.'
            : 'Эта автосверка не привязана к текущему плану.'}{' '}
          {comparisonInstructions}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {issues.map((issue) => (
            <li key={issue.code}>
              {issue.code === 'requirement_unconfirmed' ? 'Пожелание требует проверки. ' : ''}
              {issue.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2">
          {planNeedsComparison
            ? planStatus === 'changed'
              ? 'Сохранённый результат автосверки относится к изображению, не к новой версии плана. Размеры и размещение проверяйте на 2D-схеме.'
              : 'Версия плана для этой автосверки не сохранена. Размеры и размещение проверяйте на текущей 2D-схеме.'
            : 'Автосверка не нашла замечаний. Размеры и размещение проверяйте на 2D-схеме.'}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer py-1 text-ink underline decoration-accent/60 underline-offset-4 hover:decoration-accent">
          Что проверяет автосверка
        </summary>
        <p className="mt-2">
          Автосверка оценивает изображение и помогает заметить расхождения. Отсутствие замечаний не
          подтверждает каждую деталь. Размеры и размещение мебели проверяются отдельно по плану и
          меркам.
        </p>
      </details>
    </div>
  )
}
