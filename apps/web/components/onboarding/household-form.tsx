'use client'

import { Button } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveHousehold } from '@/actions/onboarding'
import { FormError } from '@/components/form-error'
import type { HouseholdInput } from '@/lib/validation/onboarding'

const adultOptions = [1, 2, 3] as const
const kidOptions = [0, 1, 2, 3] as const

function Choice({
  label,
  options,
  value,
  onChange,
  name,
  lastIsPlus,
}: {
  label: string
  options: readonly number[]
  value: number
  onChange: (value: number) => void
  name: string
  lastIsPlus?: boolean
}) {
  return (
    <fieldset className="m-0 flex flex-wrap items-center justify-between gap-4 border-0 p-0">
      <legend className="text-[15px] font-medium text-ink">{label}</legend>
      <div className="flex gap-2.5">
        {options.map((option, index) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer sr-only"
            />
            <span className="household-choice inline-flex size-11 items-center justify-center rounded-full border border-control text-[15px] text-ink-2 peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {lastIsPlus && index === options.length - 1 ? `${option}+` : option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({
  label,
  checkedHint,
  uncheckedHint,
  checked,
  onChange,
}: {
  label: string
  checkedHint: string
  uncheckedHint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="household-toggle-row group -mx-3 grid min-h-[72px] cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-3.5">
      <span className="text-[15px] font-medium text-ink">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="household-toggle-input peer sr-only"
      />
      <span
        className="household-toggle-state row-span-2 w-7 text-right font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2"
        aria-hidden="true"
      >
        {checked ? 'Да' : 'Нет'}
      </span>
      <span className="household-toggle-control relative row-span-2 h-8 w-[58px] shrink-0 rounded-full border border-control bg-muted">
        <span className="household-toggle-knob absolute left-[3px] top-[3px] grid size-6 place-items-center rounded-full bg-paper shadow-soft">
          <span className="household-toggle-mark block size-1.5 rounded-full bg-control" />
        </span>
      </span>
      <span className="mt-0.5 text-[13px] leading-snug text-ink-2">
        {checked ? checkedHint : uncheckedHint}
      </span>
    </label>
  )
}

export function HouseholdForm({
  projectId,
  initial,
}: {
  projectId: string
  initial: Partial<HouseholdInput> | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState<HouseholdInput>({
    adults: initial?.adults ?? 2,
    kids: initial?.kids ?? 0,
    pets: initial?.pets ?? false,
    cookHome: initial?.cookHome ?? true,
    receiveGuests: initial?.receiveGuests ?? false,
    wfh: initial?.wfh ?? false,
  })

  function patch(part: Partial<HouseholdInput>) {
    setValue((current) => ({ ...current, ...part }))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 border-b border-line pb-7">
        <Choice
          label="Взрослых"
          name="adults"
          options={adultOptions}
          value={value.adults}
          onChange={(adults) => patch({ adults })}
          lastIsPlus
        />
        <Choice
          label="Детей"
          name="kids"
          options={kidOptions}
          value={value.kids}
          onChange={(kids) => patch({ kids })}
          lastIsPlus
        />
      </div>
      <div className="motion-control-list flex flex-col divide-y divide-line border-y border-line">
        <Toggle
          label="Есть кот или собака"
          checkedHint="Учтём лежанку и практичные материалы"
          uncheckedHint="Отдельная зона для питомца не нужна"
          checked={value.pets}
          onChange={(pets) => patch({ pets })}
        />
        <Toggle
          label="Готовите дома"
          checkedHint="Нужны хранение и удобная рабочая поверхность"
          uncheckedHint="Кухня рассчитана на редкую готовку"
          checked={value.cookHome}
          onChange={(cookHome) => patch({ cookHome })}
        />
        <Toggle
          label="Часто принимаете гостей"
          checkedHint="Добавим запас посадочных мест"
          uncheckedHint="Не занимаем комнату лишними стульями"
          checked={value.receiveGuests}
          onChange={(receiveGuests) => patch({ receiveGuests })}
        />
        <Toggle
          label="Работаете из дома"
          checkedHint="Предусмотрим полноценное рабочее место"
          uncheckedHint="Рабочий стол можно не добавлять"
          checked={value.wfh}
          onChange={(wfh) => patch({ wfh })}
        />
      </div>

      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={() => router.push('/onboarding/step-1')}>
          Назад
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const result = await saveHousehold(projectId, value)
              if (!result.ok) {
                setError(result.error)
                return
              }
              router.push(`/onboarding/step-3?project=${projectId}`)
            })
          }}
        >
          {pending ? 'Сохраняем…' : 'Дальше'}
        </Button>
      </div>
    </div>
  )
}
