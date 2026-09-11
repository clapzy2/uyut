'use client'

import type { RoomMeasurements } from '@uyut/db'
import { Button, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateRoomMeasurements } from '@/actions/rooms'
import { FormError } from '@/components/form-error'

type Row = { name: string; width: string }

const SUGGESTIONS = ['простенок под окном', 'стена слева', 'стена справа', 'ниша']
const MAX_SPOTS = 8

function initialRows(measurements: RoomMeasurements | null): Row[] {
  const spots = measurements?.spots ?? []
  const rows = spots.map((spot) => ({ name: spot.name, width: String(spot.widthCm) }))
  return rows.length > 0 ? rows : [{ name: SUGGESTIONS[0] as string, width: '' }]
}

/**
 * Мерки рулеткой. Единственное место, откуда сервис узнаёт настоящие сантиметры.
 *
 * Рисующая модель метрики не имеет вовсе, а из площади комнаты длина стены не выводится:
 * двенадцать метров это и 3×4, и 2×6. Поэтому «влезет ли комод» считается не по картинке,
 * а вычитанием: ширина участка минус ширина товара.
 *
 * Полей намеренно мало. Человек бросит форму раньше, чем заполнит десять, а для ответа
 * «влезет или нет» хватает одной ширины участка.
 */
export function RoomMeasurementsForm({
  roomId,
  measurements,
}: {
  roomId: string
  measurements: RoomMeasurements | null
}) {
  const router = useRouter()
  const [ceiling, setCeiling] = useState(
    measurements?.ceilingCm ? String(measurements.ceilingCm) : '',
  )
  const [rows, setRows] = useState<Row[]>(() => initialRows(measurements))
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  function patch(index: number, next: Partial<Row>) {
    setRows((list) => list.map((row, at) => (at === index ? { ...row, ...next } : row)))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSaving(true)
    const result = await updateRoomMeasurements(roomId, {
      ceilingCm: ceiling,
      spots: rows.map((row) => ({ name: row.name, widthCm: row.width })),
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({ title: 'Сохранили', tone: 'success' })
    router.refresh()
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
          Мерки рулеткой
        </p>
        <p className="text-[13px] leading-relaxed text-ink-2">
          По ним считается, влезет ли мебель. Модель, которая рисует картинку, сантиметров не
          понимает, поэтому без этих чисел сказать «комод шире простенка» нам не из чего.
        </p>
      </div>

      <Input
        id={`ceiling-${roomId}`}
        label="Высота потолка, см"
        inputMode="numeric"
        value={ceiling}
        onChange={(event) => setCeiling(event.currentTarget.value)}
      />

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: строки различает только позиция, они безымянны до ввода
          <div key={index} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <Input
                id={`spot-name-${roomId}-${index}`}
                label={index === 0 ? 'Участок стены' : ''}
                list={`spot-names-${roomId}`}
                placeholder="простенок под окном"
                value={row.name}
                onChange={(event) => patch(index, { name: event.currentTarget.value })}
              />
            </div>
            <div className="w-28">
              <Input
                id={`spot-width-${roomId}-${index}`}
                label={index === 0 ? 'Ширина, см' : ''}
                inputMode="numeric"
                value={row.width}
                onChange={(event) => patch(index, { width: event.currentTarget.value })}
              />
            </div>
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => setRows((list) => list.filter((_, at) => at !== index))}
                className="py-2 text-[14px] text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors duration-200 ease-ui hover:text-ink"
              >
                Убрать
              </button>
            ) : null}
          </div>
        ))}
        <datalist id={`spot-names-${roomId}`}>
          {SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="secondary" pending={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить мерки'}
        </Button>
        {rows.length < MAX_SPOTS ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRows((list) => [...list, { name: '', width: '' }])}
          >
            Ещё участок
          </Button>
        ) : null}
      </div>
    </form>
  )
}
