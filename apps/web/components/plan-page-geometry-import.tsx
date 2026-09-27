'use client'

import type { PlanReading } from '@uyut/db'
import { Button, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPlanPageGeometryDraft } from '@/actions/plan-page-geometry'
import { FormError } from '@/components/form-error'

export function PlanPageGeometryImport({
  projectId,
  sourceRevision,
  reading,
}: {
  projectId: string
  sourceRevision: string
  reading: PlanReading
}) {
  const router = useRouter()
  const numbers = new Set(reading.pageReview?.contours.rooms.map((room) => room.roomSourceNumber))
  const options = reading.rooms.filter(
    (room) =>
      room.sourceNumber !== undefined &&
      numbers.has(room.sourceNumber) &&
      reading.rooms.filter((other) => other.sourceNumber === room.sourceNumber).length === 1,
  )
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [saving, startSaving] = useTransition()
  if (
    reading.geometry ||
    reading.planState !== 'existing' ||
    !reading.confirmedAt ||
    !options.length
  )
    return null

  function createDraft() {
    setError(undefined)
    startSaving(async () => {
      try {
        const result = await createPlanPageGeometryDraft(projectId, selected, sourceRevision)
        if (!result.ok) {
          setError(result.error)
          if (result.code === 'plan-conflict') setConflict(true)
          return
        }
        toast({ title: '2D-черновик создан по разметке PDF', tone: 'success' })
        router.refresh()
      } catch {
        setError(
          'Ответ сервера не получен. Выбор комнат остался в форме; обновите страницу перед повторным переносом.',
        )
      }
    })
  }

  return (
    <section
      className="mt-12 border-t border-line pt-8"
      aria-labelledby="page-geometry-import-title"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Из PDF в 2D · без генерации
      </p>
      <h2 id="page-geometry-import-title" className="mt-2 font-serif text-3xl text-ink">
        Перенести размеченные комнаты
      </h2>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-2">
        Проверим подписанные размеры в двух направлениях и создадим размерный черновик выбранных
        комнат, проёмов и неподвижных объектов. Неизвестные размеры не подставляются: если данных не
        хватит, покажем, что уточнить. AI-баланс не расходуется.
      </p>
      <fieldset disabled={saving || conflict} className="mt-4 space-y-2">
        <legend className="mb-2 text-sm">Какие комнаты перенести</legend>
        {options.map((room) => (
          <label key={room.sourceNumber} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-accent"
              checked={selected.includes(room.sourceNumber as number)}
              onChange={(event) => {
                const number = room.sourceNumber as number
                setSelected((current) =>
                  event.target.checked
                    ? [...current, number]
                    : current.filter((item) => item !== number),
                )
                setError(undefined)
              }}
            />
            № {room.sourceNumber} · {room.name}
          </label>
        ))}
      </fieldset>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          onClick={createDraft}
          pending={saving}
          disabled={!selected.length || selected.length > 12 || conflict}
        >
          Создать 2D-черновик из PDF
        </Button>
        {conflict ? (
          <Button variant="secondary" onClick={() => router.refresh()}>
            Загрузить актуальную версию
          </Button>
        ) : null}
      </div>
      <FormError message={error} />
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-2">
        Это ещё не подтверждённая расстановка. В редакторе нужно дополнить внешний контур, остальные
        комнаты и проёмы, открывание дверей и высоты подоконников, затем сверить схему. Существующий
        2D-чертёж эта кнопка не заменяет.
      </p>
    </section>
  )
}
