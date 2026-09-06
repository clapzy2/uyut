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
    <fieldset className="m-0 flex flex-wrap items-center justify-between gap-3 border-0 p-0">
      <legend className="text-[15px] text-ink">{label}</legend>
      <div className="flex gap-2">
        {options.map((option, index) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer sr-only"
            />
            <span className="inline-flex h-9 w-11 items-center justify-center rounded-full border border-line-strong text-sm text-ink-2 transition-colors duration-200 ease-ui hover:text-ink peer-checked:border-accent peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
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
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-[15px] text-ink">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-muted transition-colors duration-200 ease-ui peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
        <span className="absolute left-[3px] top-[3px] h-[16px] w-[16px] rounded-full bg-paper transition-transform duration-200 ease-ui peer-checked:translate-x-5" />
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
      <div className="flex flex-col gap-4 border-b border-line pb-6">
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
      <div className="flex flex-col gap-3">
        <Toggle
          label="Есть кот или собака"
          checked={value.pets}
          onChange={(pets) => patch({ pets })}
        />
        <Toggle
          label="Готовите дома"
          checked={value.cookHome}
          onChange={(cookHome) => patch({ cookHome })}
        />
        <Toggle
          label="Часто принимаете гостей"
          checked={value.receiveGuests}
          onChange={(receiveGuests) => patch({ receiveGuests })}
        />
        <Toggle label="Работаете из дома" checked={value.wfh} onChange={(wfh) => patch({ wfh })} />
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
