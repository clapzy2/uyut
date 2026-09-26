'use client'

import type { RoomMeasurements } from '@uyut/db'
import { Button, Input, inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateRoomMeasurements } from '@/actions/rooms'
import { FormError } from '@/components/form-error'
import { RoomLayoutField } from '@/components/room-layout-field'
import { dimensionSourceLabel } from '@/lib/projects/dimension-sources'
import { hasCurrentVerification, measurementNotice } from '@/lib/projects/measurement-assurance'

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
  const [width, setWidth] = useState(measurements?.widthCm ? String(measurements.widthCm) : '')
  const [depth, setDepth] = useState(measurements?.depthCm ? String(measurements.depthCm) : '')
  const [layoutNotes, setLayoutNotes] = useState(measurements?.layoutNotes ?? '')
  const [rows, setRows] = useState<Row[]>(() => initialRows(measurements))
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [finishStage, setFinishStage] = useState<NonNullable<RoomMeasurements['finishStage']>>(
    measurements?.finishStage ?? 'unknown',
  )
  const [tolerance, setTolerance] = useState(
    measurements?.toleranceCm === undefined ? '' : String(measurements.toleranceCm),
  )
  const [confirmed, setConfirmed] = useState(hasCurrentVerification(measurements))
  const draft: RoomMeasurements = {
    ...measurements,
    widthCm: Number(width.replace(',', '.')),
    depthCm: Number(depth.replace(',', '.')),
    finishStage,
    toleranceCm: tolerance.trim() ? Number(tolerance.replace(',', '.')) : undefined,
    verification: confirmed ? measurements?.verification : undefined,
  }

  function patch(index: number, next: Partial<Row>) {
    setRows((list) => list.map((row, at) => (at === index ? { ...row, ...next } : row)))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSaving(true)
    try {
      const result = await updateRoomMeasurements(roomId, {
        ceilingCm: ceiling,
        widthCm: width,
        depthCm: depth,
        finishStage,
        toleranceCm: tolerance,
        confirmDimensions: confirmed,
        layoutNotes,
        spots: rows.map((row) => ({ name: row.name, widthCm: row.width })),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast({ title: 'Мерки сохранены', tone: 'success' })
      router.refresh()
    } catch {
      setError('Не удалось сохранить мерки. Проверьте соединение и попробуйте снова.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Размеры комнаты
          </p>
          <p className="text-[13px] leading-relaxed text-ink-2">
            По ним считается, влезет ли мебель. Модель, которая рисует картинку, сантиметров не
            понимает, поэтому без этих чисел сказать «комод шире простенка» нам не из чего.
          </p>
        </div>

        <div className="text-[13px] leading-relaxed text-ink-2" aria-live="polite">
          <p>
            Ширина: {dimensionSourceLabel(measurements, 'widthCm', Number(width.replace(',', '.')))}
            .
          </p>
          <p>
            Глубина:{' '}
            {dimensionSourceLabel(measurements, 'depthCm', Number(depth.replace(',', '.')))}.
          </p>
          <p>
            Сохранение чисел не подтверждает замер. Перед покупкой проверьте размеры после отделки и
            монтажные зазоры.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            id={`ceiling-${roomId}`}
            className="w-32"
            label="Потолок, см"
            inputMode="numeric"
            value={ceiling}
            onChange={(event) => setCeiling(event.currentTarget.value)}
          />
          <Input
            id={`room-width-${roomId}`}
            className="w-40"
            label="Ширина комнаты, см"
            inputMode="numeric"
            value={width}
            onChange={(event) => {
              setWidth(event.currentTarget.value)
              setConfirmed(false)
            }}
          />
          <Input
            id={`room-depth-${roomId}`}
            className="w-40"
            label="Глубина комнаты, см"
            inputMode="numeric"
            value={depth}
            onChange={(event) => {
              setDepth(event.currentTarget.value)
              setConfirmed(false)
            }}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label
            className="flex min-w-0 flex-col gap-2 text-[13px]"
            htmlFor={`finish-stage-${roomId}`}
          >
            Когда сделаны замеры
            <select
              id={`finish-stage-${roomId}`}
              className={inputClassName}
              value={finishStage}
              onChange={(event) => {
                setFinishStage(
                  event.currentTarget.value as NonNullable<RoomMeasurements['finishStage']>,
                )
                setConfirmed(false)
              }}
            >
              <option value="unknown">Не указано</option>
              <option value="before">До отделки</option>
              <option value="after">После отделки</option>
            </select>
          </label>
          <Input
            id={`tolerance-${roomId}`}
            className="w-44"
            label="Погрешность, ± см"
            inputMode="decimal"
            value={tolerance}
            onChange={(event) => {
              setTolerance(event.currentTarget.value)
              setConfirmed(false)
            }}
          />
        </div>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Погрешность — возможная ошибка полного размера, а не запас для монтажа. Например, 300 ±1
          см означает от 299 до 301 см. Толщину будущей отделки мы автоматически не вычитаем.
          Дробные сантиметры сохраняются без округления до целого.
        </p>
        <label className="flex items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-current"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
          />
          Я сверил ширину и глубину комнаты замером и указал этап отделки и погрешность
        </label>
        <p role="status" className="text-[13px] leading-relaxed text-ink-2">
          {confirmed && !hasCurrentVerification(draft)
            ? 'Подтверждение будет записано после сохранения, если все необходимые поля заполнены.'
            : measurementNotice(draft)}
        </p>
        <p className="-mt-1 text-[13px] leading-relaxed text-ink-2">
          Размеры комнаты подставим с загруженного плана. Для проверки конкретного места добавьте
          замер свободного участка стены — например, простенка под окном. Общие размеры помогают
          исключить слишком крупные предметы, а участок уточняет подбор для выбранного места.
        </p>

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

        <RoomLayoutField
          id={`room-layout-${roomId}`}
          value={layoutNotes}
          onChange={setLayoutNotes}
        />

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
      </fieldset>
    </form>
  )
}
