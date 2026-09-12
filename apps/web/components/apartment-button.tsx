'use client'

import { Button, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { requestApartmentConcepts } from '@/actions/concepts'
import { FormError } from '@/components/form-error'
import { type ApartmentRoom, skipReasons } from '@/lib/concepts/apartment'

function renderWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} картинка`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} картинки`
  }
  return `${count} картинок`
}

/**
 * Обставить всю квартиру одним нажатием.
 *
 * До запуска человек видит, какие комнаты пойдут, какие нет и почему, и сколько картинок
 * получится. Это не мелкая любезность: запуск платный, и узнавать цену после списания поздно.
 */
export function ApartmentButton({
  projectId,
  rooms,
  ready,
  renders,
}: {
  projectId: string
  rooms: ApartmentRoom[]
  ready: ApartmentRoom[]
  renders: number
}) {
  const router = useRouter()
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const skipped = rooms.filter((room) => room.skip)

  async function start() {
    setError(undefined)
    setPending(true)
    const result = await requestApartmentConcepts(projectId)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({ title: 'Запустили. Комнаты будут готовы по очереди', tone: 'success' })
    router.refresh()
  }

  if (ready.length === 0) {
    return null
  }

  return (
    <div className="mt-8 animate-[rise-in_350ms_var(--ease-appear)] border border-line bg-paper p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Вся квартира сразу
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink">
        Обставим в одном стиле: {ready.map((room) => room.name).join(', ')}. Выйдет{' '}
        {renderWord(renders)}, по три варианта на комнату. Заходить в каждую комнату и ждать по
        очереди не придётся.
      </p>
      {skipped.length > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Не пойдут:{' '}
          {skipped
            .map(
              (room) => `${room.name} — ${skipReasons[room.skip as NonNullable<typeof room.skip>]}`,
            )
            .join('; ')}
          .
        </p>
      ) : null}
      <FormError message={error} />
      <div className="mt-4">
        <Button type="button" onClick={start} pending={pending}>
          {pending ? 'Запускаем…' : 'Обставить всю квартиру'}
        </Button>
      </div>
    </div>
  )
}
