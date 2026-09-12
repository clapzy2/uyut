'use client'

import { chipClassName, FieldError } from '@uyut/ui'
import type { ReactNode } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { mvpRoomKinds, roomKindLabels } from '@/lib/projects/format'

// Те же чипы, что и в остальных шагах: общая реакция на выбор и нажатие.
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
            <span className={chipClassName}>{roomKindLabels[kind]}</span>
          </label>
        ))}
      </div>
      <FieldError id="kind-error">{error}</FieldError>
    </fieldset>
  )
}
