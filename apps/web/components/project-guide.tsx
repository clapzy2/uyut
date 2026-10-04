import { buttonClassName } from '@uyut/ui'
import Link from 'next/link'

type GuideRoom = { id: string; name: string; conceptCount: number }

type ProjectGuideProps = {
  projectId: string
  isOwner: boolean
  onboarded: boolean
  hasPlan: boolean
  planNeedsReview: boolean
  rooms: GuideRoom[]
  shoppingCount: number
}

export function ProjectGuide({
  projectId,
  isOwner,
  onboarded,
  hasPlan,
  planNeedsReview,
  rooms,
  shoppingCount,
}: ProjectGuideProps) {
  const projectPath = `/projects/${projectId}`
  const nextRoom = rooms.find((room) => room.conceptCount === 0)
  const roomWithConcepts = rooms.find((room) => room.conceptCount > 0)
  let stage = 0
  let title = 'Начните с плана или добавьте комнату'
  let text =
    'Есть план — загрузите его и сверьте найденные комнаты. Нет плана — добавьте комнату вручную; размеры можно уточнить позже.'
  let href = hasPlan ? '#project-plan' : '#project-rooms'
  let action = hasPlan ? 'Проверить план' : 'Добавить комнату'

  if (!isOwner) {
    title = 'Выбирайте интерьер вместе'
    text =
      'Откройте комнату и отметьте понравившиеся варианты. План, размеры и список покупок меняет владелец; ваши отметки сохраняются отдельно.'
    href = '#project-rooms'
    action = 'Посмотреть комнаты'
    stage = 1
  } else if (!onboarded) {
    title = 'Расскажите, для кого обустраиваем квартиру'
    text =
      'Состав семьи, бюджет и любимые интерьеры помогут подобрать варианты. Затем вернёмся сюда — к комнатам и плану.'
    href = `/onboarding/step-2?project=${projectId}`
    action = 'Продолжить анкету'
  } else if (planNeedsReview) {
    title = 'Сверьте комнаты на загруженном плане'
    text =
      'Прочитайте нужный лист и проверьте найденные размеры перед переносом. Если план нечёткий, можно продолжить с комнатами, добавленными вручную.'
    href = '#project-plan'
    action = 'К загруженному плану'
  } else if (rooms.length > 0 && nextRoom) {
    stage = 1
    title = `Подготовьте комнату «${nextRoom.name}»`
    text =
      'Уточните размеры, отделку и пожелания, затем запустите варианты интерьера. Фото помогает передать особенности комнаты, но его можно добавить позже.'
    href = `${projectPath}/rooms/${nextRoom.id}`
    action = 'Открыть комнату'
  } else if (shoppingCount > 0) {
    stage = 3
    title = 'Сверьте выбранную мебель и соберите документ'
    text =
      'В итогах — покупки по комнатам, проверка расстановки, смета и PDF. Перед покупкой сверьте вариант товара и мерки на месте.'
    href = `${projectPath}/summary`
    action = 'К покупкам и PDF'
  } else if (roomWithConcepts) {
    stage = 2
    title = 'От интерьера — к конкретной мебели'
    text =
      'Откройте вариант комнаты, нажмите на метку предмета и выберите товар. Добавленные позиции появятся в общем списке покупок и на 2D-схеме.'
    href = `${projectPath}/rooms/${roomWithConcepts.id}`
    action = 'Посмотреть варианты'
  }

  const steps = [
    { label: 'Квартира', href: '#project-plan' },
    { label: 'Интерьер', href: '#project-rooms' },
    { label: 'Мебель и расстановка', href: '#project-rooms' },
    { label: 'Смета и PDF', href: `${projectPath}/summary` },
  ]

  return (
    <aside aria-label="Как работать с проектом" className="mt-8 border-y border-line py-5 sm:py-6">
      <nav aria-label="Этапы проекта">
        <ol className="grid grid-cols-2 gap-x-5 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-6">
          {steps.map((step, index) => (
            <li key={step.label}>
              <Link
                href={step.href}
                aria-current={index === stage ? 'step' : undefined}
                className={`inline-flex min-h-11 items-center gap-2 text-[13px] transition-colors duration-200 hover:text-accent ${index === stage ? 'font-medium text-accent' : 'text-ink-2'}`}
              >
                <span aria-hidden="true" className="font-mono text-[11px]">
                  0{index + 1}
                </span>
                {step.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-4 grid gap-4 border-l-2 border-accent pl-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-ink-2">Следующий шаг</p>
          <h2 className="mt-1 font-serif text-[22px] leading-tight text-ink">{title}</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-2">{text}</p>
        </div>
        <Link
          href={href}
          className={buttonClassName({ variant: 'secondary', className: 'justify-self-start' })}
        >
          {action}
        </Link>
      </div>
      <details className="project-guide-details mt-4">
        <summary className="w-fit cursor-pointer py-2 text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
          Впервые здесь? Коротко о четырёх этапах
        </summary>
        <ol className="project-guide-body mt-2 grid gap-4 text-[14px] leading-relaxed text-ink-2 sm:grid-cols-2">
          <li>
            <strong className="font-medium text-ink">Квартира.</strong> Загрузите план существующего
            состояния или добавьте комнаты вручную. Найденные размеры показываем для сверки;
            неизвестные нужно уточнить.
          </li>
          <li>
            <strong className="font-medium text-ink">Интерьер.</strong> Выберите стиль и варианты
            обстановки. Концепт показывает внешний вид, а размеры проверяются отдельно на схеме.
          </li>
          <li>
            <strong className="font-medium text-ink">Мебель и расстановка.</strong> Выбирайте товары
            по меткам на картинке. На 2D-схеме смотрите габариты и проходы; в объёмном просмотре —
            ту же расстановку с известными высотами.
          </li>
          <li>
            <strong className="font-medium text-ink">Смета и PDF.</strong> Соберите покупки и
            ориентир стоимости работ в один документ для обсуждения с мастерами. Мебель оплачивается
            отдельно в магазинах.
          </li>
        </ol>
      </details>
    </aside>
  )
}
