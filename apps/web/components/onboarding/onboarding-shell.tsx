import type { ReactNode } from 'react'

export const ONBOARDING_STEPS = 5

const stepNumbers = Array.from({ length: ONBOARDING_STEPS }, (_, index) => index + 1)

// Общая рамка всех пяти шагов: полоса прогресса, номер шага, заголовок и подпись.
export function OnboardingShell({
  step,
  title,
  hint,
  children,
}: {
  step: number
  title: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex gap-1.5" aria-hidden="true">
        {stepNumbers.map((number) => (
          <span
            key={number}
            className={
              number <= step
                ? 'h-[3px] flex-1 rounded-full bg-accent'
                : 'h-[3px] flex-1 rounded-full bg-line'
            }
          />
        ))}
      </div>
      <p className="mt-4 font-mono text-[13px] text-ink-2">
        Шаг {step} из {ONBOARDING_STEPS}
      </p>
      <h1 className="mt-2 font-serif text-[32px] font-normal leading-[1.1] tracking-tight text-ink sm:text-[40px]">
        {title}
      </h1>
      {hint ? <div className="mt-3 text-[15px] leading-relaxed text-ink-2">{hint}</div> : null}
      <div className="mt-8">{children}</div>
    </section>
  )
}
