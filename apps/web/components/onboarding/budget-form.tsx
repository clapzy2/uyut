'use client'

import { Button } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveBudget } from '@/actions/onboarding'
import { FormError } from '@/components/form-error'
import { BUDGET_DEFAULT_KOPECKS } from '@/lib/validation/onboarding'

// Шкала нелинейная: до миллиона шаг пятьдесят тысяч, дальше сто. Так мелкие бюджеты настраиваются
// точнее, а крупные не растягивают ползунок.
const steps: number[] = [
  ...Array.from({ length: 19 }, (_, index) => (100_000 + index * 50_000) * 100),
  ...Array.from({ length: 20 }, (_, index) => (1_100_000 + index * 100_000) * 100),
]

const rubles = new Intl.NumberFormat('ru-RU')

function nearestIndex(kopecks: number): number {
  let best = 0
  for (let index = 1; index < steps.length; index += 1) {
    const current = steps[index] ?? 0
    const previous = steps[best] ?? 0
    if (Math.abs(current - kopecks) < Math.abs(previous - kopecks)) {
      best = index
    }
  }
  return best
}

export function BudgetForm({ projectId, initial }: { projectId: string; initial: number | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(() => nearestIndex(initial ?? BUDGET_DEFAULT_KOPECKS))
  const kopecks = steps[index] ?? BUDGET_DEFAULT_KOPECKS

  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="font-serif text-[34px] leading-none text-ink">
          {rubles.format(Math.round(kopecks / 100))} ₽
        </p>
        <p className="mt-2 text-[15px] text-ink-2">на мебель, отделку и декор всей квартиры</p>
      </div>

      <div>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-label="Бюджет"
          aria-valuetext={`${rubles.format(Math.round(kopecks / 100))} рублей`}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent"
        />
        <div className="mt-2 flex justify-between font-mono text-[12px] text-ink-2">
          <span>100 тыс.</span>
          <span>3 млн</span>
        </div>
      </div>

      <p className="border-l-2 border-line-strong pl-4 text-[15px] leading-relaxed text-ink-2">
        Это ориентир, а не обязательство. По нему подбираем уровень мебели в концептах, а в
        следующей фазе — товары в смете.
      </p>

      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/onboarding/step-2?project=${projectId}`)}
        >
          Назад
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const result = await saveBudget(projectId, { budgetKopecks: kopecks })
              if (!result.ok) {
                setError(result.error)
                return
              }
              router.push(`/onboarding/step-4?project=${projectId}`)
            })
          }}
        >
          {pending ? 'Сохраняем…' : 'Дальше'}
        </Button>
      </div>
    </div>
  )
}
