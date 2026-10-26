'use client'

import type { RoomMeasurements } from '@uyut/db'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setRoomProjectedContour } from '@/actions/rooms'

export function RoomProjectedContourForm({
  roomId,
  geometryKey,
  options,
  binding,
  hasPhoto,
}: {
  roomId: string
  geometryKey: string | null
  options: Array<{ roomIndex: number; name: string; sourceNumbers: number[] }>
  binding?: RoomMeasurements['projectedContour']
  hasPhoto: boolean
}) {
  const router = useRouter()
  const current =
    binding && binding.geometryKey === geometryKey
      ? options.find((option) => option.roomIndex === binding.roomIndex)
      : undefined
  const [selection, setSelection] = useState(current ? String(current.roomIndex) : '')
  const [reviewed, setReviewed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  if (!options.length && !binding) return null

  async function save(clear: boolean) {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await setRoomProjectedContour(roomId, {
        roomIndex: clear ? null : Number(selection),
        expectedGeometryKey: (clear ? binding?.geometryKey : geometryKey) ?? '',
        expectedRoomIndex: binding?.roomIndex,
        reviewed,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMessage(
        clear ? 'Связь с проектным контуром убрана.' : 'Проектный контур связан с комнатой.',
      )
      setReviewed(false)
      router.refresh()
    } catch {
      setError('Не получилось сохранить связь. Попробуйте ещё раз.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Проектный контур для мебели" className="border border-line p-4">
      <h2 className="font-serif text-xl text-ink">Расстановка по проектному контуру</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        Выберите область будущей планировки. Возьмём её форму и масштаб из PDF, без растягивания под
        старые мерки комнаты. Неизвестные высоты, пороги и открывание остаются неизвестными. Это
        предварительная расстановка, а не натурный обмер.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        Общая зона с несколькими номерами получает одну расстановку. Стены между её функциями не
        добавляются. При смене контура закреплённые координаты мебели сбросятся; товары, габариты и
        мерки комнаты сохранятся.
      </p>
      {binding ? (
        <p role="status" className="mt-3 text-sm text-ink">
          {current
            ? `Для предварительной расстановки выбрана область «${current.name}», № ${current.sourceNumbers.join('+')}, PDF, страница ${binding.pdfPage}. ${hasPhoto ? 'Это выбор владельца; совпадение с фото не подтверждено автоматически.' : ''}`
            : 'Связь с проектным контуром устарела. Расстановка по прежним меркам вместо него не строится. Сверьте область и сохраните связь заново.'}
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink-2">
          Связь ещё не выбрана. Совпадение названия комнаты с подписью PDF её не создаёт.
        </p>
      )}
      {options.length > 0 ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save(false)
          }}
        >
          <label className="grid gap-2 text-sm text-ink">
            Проектная область для расстановки
            <select
              aria-label="Проектная область для расстановки"
              value={selection}
              disabled={saving}
              onChange={(event) => {
                setSelection(event.target.value)
                setReviewed(false)
              }}
              className="min-h-11 w-full border border-line-strong bg-surface p-2"
            >
              <option value="">Выберите область</option>
              {options.map((option) => (
                <option key={option.roomIndex} value={option.roomIndex}>
                  {option.name} · № {option.sourceNumbers.join('+')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm leading-relaxed text-ink">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={saving}
              onChange={(event) => setReviewed(event.target.checked)}
              className="mt-1 accent-accent"
            />
            {hasPhoto
              ? 'Сверил(а) видимые стены и проёмы на фото с выбранной областью PDF. Понимаю, что это проектная расстановка, а не подтверждённый обмер.'
              : 'Понимаю, что это проектная расстановка, а не подтверждённый обмер'}
          </label>
          <button
            type="submit"
            disabled={saving || selection === '' || !reviewed || !geometryKey}
            className="min-h-11 border border-line-strong px-4 py-2 text-sm text-ink disabled:opacity-50"
          >
            {saving ? 'Сохраняем связь…' : 'Связать с проектным контуром'}
          </button>
        </form>
      ) : null}
      {binding ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(true)}
          className="mt-3 min-h-11 text-sm text-ink-2 underline underline-offset-4"
        >
          Убрать связь с проектным контуром
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-ink">
          {message}
        </p>
      ) : null}
    </section>
  )
}
