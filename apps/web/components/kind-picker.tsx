'use client'

import { FieldError } from '@uyut/ui'
import type { ReactNode } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { mvpRoomKinds, roomKindLabels } from '@/lib/projects/format'

// Три чипа-радиокнопки: тонкая линия вместо заливки, выбранный подчёркнут акцентом
export function KindPicker({
  registration,
  error,
}: {
  registration: UseFormRegisterReturn
  error?: ReactNode
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 block text-xs font-medium uppercase tracking-[0.1em] text-ink-2">
        Тип комнаты
      </legend>
      <div className="flex flex-wrap gap-2">
        {mvpRoomKinds.map((kind) => (
          <label key={kind} className="cursor-pointer">
            <input type="radio" value={kind} className="peer sr-only" {...registration} />
            <span className="inline-flex h-9 items-center rounded-full border border-control px-4 text-sm text-ink-2 transition-colors duration-200 ease-ui hover:text-ink peer-checked:border-accent peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {roomKindLabels[kind]}
            </span>
          </label>
        ))}
      </div>
      <FieldError id="kind-error">{error}</FieldError>
    </fieldset>
  )
}
