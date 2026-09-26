import type { ConceptQualityReview } from '@uyut/db'

export function QualityReview({
  review,
  edited,
}: {
  review: ConceptQualityReview | null
  edited: boolean
}) {
  if (edited) {
    return (
      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
        Цвета обновлены. Сверьте важные детали с исходным концептом: для изменённой версии новая
        автосверка не выполнялась.
      </p>
    )
  }
  if (!review || review.status === 'unavailable') {
    return (
      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
        {review
          ? 'Концепт сохранён. Автосверка сейчас недоступна — сравните окна, двери и важные детали с исходным планом или фото.'
          : 'Концепт готов к просмотру. Для этого варианта автосверка не выполнялась — сравните важные детали с исходным планом или фото.'}
      </p>
    )
  }
  return (
    <div className="mt-4 border border-line bg-paper p-4 text-[14px] leading-relaxed text-ink-2">
      <p className="font-medium text-ink">
        {review.status === 'review'
          ? 'Автосверка: посмотрите отмеченные детали'
          : 'Автосверка выполнена'}
      </p>
      {review.issues.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {review.issues.map((issue) => (
            <li key={issue.code}>
              {issue.code === 'requirement_unconfirmed' ? 'Пожелание требует проверки. ' : ''}
              {issue.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2">
          Автосверка не нашла замечаний. Перед выбором сравните вариант со своими пожеланиями и
          исходным планом: отсутствие замечаний не подтверждает каждую деталь.
        </p>
      )}
      <p className="mt-2">
        Автосверка оценивает изображение и помогает заметить расхождения. Размеры и размещение
        мебели проверяются отдельно по плану и меркам.
      </p>
    </div>
  )
}
