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
      <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
        После изменения цветов эта версия не проверялась автоматически.
      </p>
    )
  }
  if (!review || review.status === 'unavailable') {
    return (
      <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
        {review
          ? 'Автопроверка сейчас недоступна. Картинка сохранена, но её нужно проверить самостоятельно.'
          : 'Этот вариант создан без автопроверки.'}
      </p>
    )
  }
  return (
    <div className="mt-4 border border-line bg-paper p-4 text-[13px] leading-relaxed text-ink-2">
      <p className="font-medium text-ink">
        {review.status === 'review'
          ? 'Автопроверка: есть замечания — проверьте результат'
          : 'Автопроверка выполнена'}
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
        <p className="mt-2">Модель не отметила замечаний. Это не подтверждение всех пожеланий.</p>
      )}
      <p className="mt-2">
        Это подсказка модели, она может ошибаться. Размеры, соответствие плану и то, влезет ли
        мебель, нужно проверить отдельно.
      </p>
    </div>
  )
}
