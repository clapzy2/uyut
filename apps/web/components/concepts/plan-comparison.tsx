import type { ConceptPageData } from '@/lib/concepts/objects'

type Plan = NonNullable<ConceptPageData['plan']>

const sideLabels = {
  top: 'сверху',
  right: 'справа',
  bottom: 'снизу',
  left: 'слева',
  inner: 'на внутренней стене',
} as const

const openingLabels = {
  window: 'Окно',
  door: 'Дверь',
  balcony: 'Балконный блок',
} as const

export function PlanComparison({
  plan,
  renderSrc,
}: {
  plan: Plan | null
  renderSrc: string | null
}) {
  if (!plan || !renderSrc) return null

  return (
    <details className="group mt-10 border-y border-line py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] text-ink marker:content-none">
        <span className="font-medium">Сверить концепт с планом</span>
        <span
          aria-hidden="true"
          className="text-accent transition-transform duration-200 group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="mt-6 grid gap-5 md:grid-cols-2 md:gap-7">
        <figure className="min-w-0">
          <div className="grid min-h-48 place-items-center border border-line bg-muted">
            {plan.isPdf ? (
              <a
                href={plan.src}
                target="_blank"
                rel="noreferrer"
                className="p-6 text-center text-[15px] text-accent underline underline-offset-4"
              >
                Открыть план PDF в новой вкладке
              </a>
            ) : (
              // biome-ignore lint/performance/noImgElement: приватная подписанная ссылка, без постоянного URL для оптимизатора
              <img
                src={plan.src}
                alt={plan.label}
                className="block max-h-[480px] max-w-full object-contain"
              />
            )}
          </div>
          <figcaption className="mt-2 text-[12px] uppercase tracking-[0.1em] text-ink-2">
            {plan.label}
          </figcaption>
        </figure>
        <figure className="min-w-0">
          <div className="grid min-h-48 place-items-center border border-line bg-muted">
            {/* biome-ignore lint/performance/noImgElement: приватная подписанная ссылка, без постоянного URL для оптимизатора */}
            <img
              src={renderSrc}
              alt="Сгенерированный интерьер"
              className="block max-h-[480px] max-w-full object-contain"
            />
          </div>
          <figcaption className="mt-2 text-[12px] uppercase tracking-[0.1em] text-ink-2">
            Концепт
          </figcaption>
        </figure>
      </div>
      {plan.architecture ? (
        <div className="mt-5 border-l-2 border-accent pl-4 text-[13px] leading-relaxed text-ink-2">
          <p className="font-medium text-ink">Что подтверждено на плане</p>
          <p>
            Контур {plan.architecture.shape === 'rectangular' ? 'прямоугольный' : 'непрямоугольный'}
            .
            {plan.architecture.openings.length === 0
              ? ' Проёмы в разметке не указаны.'
              : ` Проёмы: ${plan.architecture.openings
                  .map(
                    (opening) =>
                      `${openingLabels[opening.type].toLowerCase()} ${sideLabels[opening.side]}`,
                  )
                  .join(', ')}.`}
          </p>
        </div>
      ) : (
        <p className="mt-5 text-[13px] leading-relaxed text-ink-2">
          Разметка этой комнаты ещё не подтверждена. Сравните видимые окна, двери и форму вручную.
        </p>
      )}
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        Стороны указаны относительно плана, а не камеры. Невидимый в кадре проём нельзя считать
        отсутствующим; по картинке нельзя проверить сантиметровые размеры.
      </p>
    </details>
  )
}
