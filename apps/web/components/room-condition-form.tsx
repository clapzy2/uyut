'use client'

import type { RoomCondition } from '@uyut/db'
import { roomConditions } from '@uyut/db'
import { toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateRoomCondition } from '@/actions/rooms'
import { FormError } from '@/components/form-error'
import { roomConditionHints, roomConditionLabels } from '@/lib/projects/format'

/**
 * Что делаем с комнатой. Стоит под фотографией, потому что решение принимают, глядя на неё:
 * это единственное место, где видно и снимок, и то, что с ним собирается сделать сервис.
 *
 * Сохраняется сразу по выбору, без кнопки: выбор из трёх вариантов не та работа,
 * которую стоит подтверждать отдельным нажатием.
 */
export function RoomConditionForm({
  roomId,
  condition,
}: {
  roomId: string
  condition: RoomCondition
}) {
  const router = useRouter()
  const [value, setValue] = useState<RoomCondition>(condition)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  function choose(next: RoomCondition) {
    const previous = value
    setValue(next)
    setError(undefined)
    startTransition(async () => {
      const result = await updateRoomCondition(roomId, { condition: next })
      if (!result.ok) {
        setValue(previous)
        setError(result.error)
        return
      }
      toast({ title: 'Сохранили', tone: 'success' })
      router.refresh()
    })
  }

  return (
    <fieldset className="m-0 border-0 p-0" disabled={pending}>
      <legend className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Что делаем с комнатой
      </legend>
      <div className="flex flex-col gap-2">
        {roomConditions.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={`condition-${roomId}`}
              value={option}
              checked={value === option}
              onChange={() => choose(option)}
              className="peer sr-only"
            />
            <span className="block border border-control px-4 py-3 transition-colors duration-200 ease-ui hover:border-line-strong peer-checked:border-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              <span className="block text-[15px] text-ink">{roomConditionLabels[option]}</span>
              <span className="mt-1 block text-[13px] leading-relaxed text-ink-2">
                {roomConditionHints[option]}
              </span>
            </span>
          </label>
        ))}
      </div>
      <FormError message={error} />
    </fieldset>
  )
}
