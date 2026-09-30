'use client'

import type { PlanReading } from '@uyut/db'
import { Button, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPlanPageGeometryDraft } from '@/actions/plan-page-geometry'
import { FormError } from '@/components/form-error'
import { pdfContourKey, pdfContourRoomNumbers } from '@/lib/projects/plan-pdf-room-binding'

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
  const options = (reading.pageReview?.contours.rooms ?? []).flatMap((contour) => {
    const numbers = [...pdfContourRoomNumbers(contour)]
    const members = numbers.map((number) =>
      reading.rooms.filter((room) => room.sourceNumber === number),
    )
    return members.every((rooms) => rooms.length === 1)
      ? [
          {
            key: pdfContourKey(contour),
            numbers,
            name: members
              .flat()
              .map((room) => room.name)
              .join(' / '),
          },
        ]
      : []
  })
  const sourceRooms = reading.pageReview?.sourceRooms ?? []
  const reviewedNumbers = new Set(options.flatMap((room) => room.numbers))
  const readingNumbers = new Set(
    reading.rooms.flatMap((room) => (room.sourceNumber === undefined ? [] : [room.sourceNumber])),
  )
  const unreviewedSourceRooms = sourceRooms.filter(
    (room) => !reviewedNumbers.has(room.sourceNumber) || !readingNumbers.has(room.sourceNumber),
  )
  const anchors = reading.rooms.filter(
    (room) =>
      room.sourceNumber !== undefined &&
      reading.pageReview?.contours.rooms.some(
        (contour) => contour.roomSourceNumber === room.sourceNumber,
      ) &&
      room.measurementEvidence?.width &&
      room.measurementEvidence.depth &&
      room.widthCm &&
      room.depthCm &&
      !room.estimated?.length &&
      !room.chainMismatch?.length,
  )
  const [selected, setSelected] = useState<number[]>([])
  const [globalScale, setGlobalScale] = useState(false)
  const [anchor, setAnchor] = useState(String(anchors[0]?.sourceNumber ?? ''))
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
        const result = await createPlanPageGeometryDraft(
          projectId,
          selected,
          sourceRevision,
          globalScale ? [Number(anchor)] : undefined,
        )
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
      {sourceRooms.length > 0 ? (
        <div className="mt-5 max-w-2xl border-l-2 border-accent bg-accent-tint/20 py-3 pl-4 pr-3">
          <p className="text-[13px] font-medium text-ink">
            По экспликации листа размечено {sourceRooms.length - unreviewedSourceRooms.length} из{' '}
            {sourceRooms.length} помещений.
          </p>
          {unreviewedSourceRooms.length > 0 ? (
            <>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                Черновик можно создать по готовым контурам. Всю квартиру подтвердить пока нельзя:
              </p>
              <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-ink">
                {unreviewedSourceRooms.map((room) => (
                  <li key={room.sourceNumber}>
                    № {String(room.sourceNumber).padStart(2, '0')} · {room.name} —{' '}
                    {readingNumbers.has(room.sourceNumber)
                      ? 'нужен контур по исходному листу'
                      : 'сначала добавьте в список комнат, затем разметьте контур'}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={saving || conflict} className="mt-4 space-y-2">
        <legend className="mb-2 text-sm">Какие комнаты перенести</legend>
        {options.map((room) => (
          <label key={room.key} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-accent"
              checked={room.numbers.every((number) => selected.includes(number))}
              onChange={(event) => {
                setSelected((current) =>
                  event.target.checked
                    ? [...new Set([...current, ...room.numbers])]
                    : current.filter((item) => !room.numbers.includes(item)),
                )
                setError(undefined)
              }}
            />
            № {room.key} · {room.name}
          </label>
        ))}
        {anchors.length ? (
          <div className="border-t border-line pt-3">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={globalScale}
                onChange={(event) => setGlobalScale(event.target.checked)}
              />
              Перенести все выбранные контуры в едином масштабе листа
            </label>
            {globalScale ? (
              <label className="block text-sm">
                Комната для проверки масштаба в двух направлениях
                <select
                  className="mt-2 block border border-line bg-surface p-2"
                  value={anchor}
                  onChange={(event) => setAnchor(event.target.value)}
                >
                  {anchors.map((room) => (
                    <option key={room.sourceNumber} value={room.sourceNumber}>
                      № {room.sourceNumber} · {room.name}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block max-w-2xl text-xs leading-relaxed text-ink-2">
                  Координаты остальных зон перенесём по нативным линиям, не подставляя им
                  отсутствующие мерки. Общая зона остаётся одним контуром. Ширины проёмов без
                  подписей потребуют отдельной сверки.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
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
