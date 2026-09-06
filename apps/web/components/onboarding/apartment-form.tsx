'use client'

import { Button, FieldHint, Input, Label, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createApartment } from '@/actions/onboarding'
import { FormError } from '@/components/form-error'
import {
  houseSeries,
  type SeriesRoomCount,
  seriesLayout,
  seriesRoomCounts,
} from '@/lib/onboarding/house-series'
import { formatArea, mvpRoomKinds, roomKindLabels } from '@/lib/projects/format'

type Mode = 'manual' | 'plan' | 'series'

type ManualRoom = {
  /** Ключ для React: комнаты ещё не сохранены, своего идентификатора у них нет */
  key: string
  kind: (typeof mvpRoomKinds)[number]
  name: string
  area: string
}

function roomKey(): string {
  return crypto.randomUUID()
}

const modeLabels: Record<Mode, string> = {
  manual: 'Впишу комнаты сам',
  plan: 'Загружу план квартиры',
  series: 'Знаю серию дома',
}

function defaultRooms(): ManualRoom[] {
  return [
    { key: roomKey(), kind: 'living', name: 'Гостиная', area: '' },
    { key: roomKey(), kind: 'kitchen', name: 'Кухня', area: '' },
  ]
}

function parseArea(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') {
    return null
  }
  const number = Number(normalized)
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null
}

export function ApartmentForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('manual')
  const [title, setTitle] = useState('Моя квартира')
  const [totalArea, setTotalArea] = useState('')
  const [rooms, setRooms] = useState<ManualRoom[]>(defaultRooms)
  const [seriesId, setSeriesId] = useState(houseSeries[0]?.id ?? '')
  const [roomCount, setRoomCount] = useState<SeriesRoomCount>(2)

  const preview = mode === 'series' ? seriesLayout(seriesId, roomCount) : []

  function submit() {
    setError(null)
    const input =
      mode === 'series'
        ? { mode, title, seriesId, roomCount }
        : mode === 'plan'
          ? { mode, title, totalAreaM2: parseArea(totalArea) }
          : {
              mode,
              title,
              totalAreaM2: parseArea(totalArea),
              rooms: rooms.map((room) => ({
                kind: room.kind,
                name: room.name.trim(),
                areaM2: parseArea(room.area),
              })),
            }
    startTransition(async () => {
      const result = await createApartment(input)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // В режиме плана остаёмся на первом шаге: проект уже есть, дальше загрузка файла
      const next = mode === 'plan' ? 'step-1' : 'step-2'
      router.push(`/onboarding/${next}?project=${result.data.projectId}`)
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <Input
        id="title"
        label="Название проекта"
        hint="Чтобы отличать от других квартир. Можно поменять позже."
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={80}
      />

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 block text-xs font-medium uppercase tracking-[0.1em] text-ink-2">
          Откуда возьмём комнаты
        </legend>
        <div className="flex flex-wrap gap-2">
          {(['manual', 'plan', 'series'] as const).map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="peer sr-only"
              />
              <span className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-sm text-ink-2 transition-colors duration-200 ease-ui hover:text-ink peer-checked:border-accent peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                {modeLabels[value]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'manual' ? (
        <div className="flex flex-col gap-4">
          {rooms.map((room, index) => (
            <div
              key={room.key}
              className="flex flex-wrap items-end gap-3 border-b border-line pb-4 last:border-0"
            >
              <Input
                id={`room-name-${index}`}
                label="Комната"
                className="min-w-[9rem] flex-1"
                value={room.name}
                onChange={(event) =>
                  setRooms((list) =>
                    list.map((item, position) =>
                      position === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
                maxLength={40}
              />
              <Input
                id={`room-area-${index}`}
                label="Площадь, м²"
                className="w-28"
                inputMode="decimal"
                value={room.area}
                onChange={(event) =>
                  setRooms((list) =>
                    list.map((item, position) =>
                      position === index ? { ...item, area: event.target.value } : item,
                    ),
                  )
                }
              />
              <div className="w-36">
                <Label htmlFor={`room-kind-${index}`}>Тип</Label>
                <select
                  id={`room-kind-${index}`}
                  value={room.kind}
                  onChange={(event) =>
                    setRooms((list) =>
                      list.map((item, position) =>
                        position === index
                          ? { ...item, kind: event.target.value as ManualRoom['kind'] }
                          : item,
                      ),
                    )
                  }
                  className="h-11 w-full border border-line-strong bg-paper px-3 text-[15px] text-ink outline-none transition-colors duration-200 ease-ui focus-visible:border-accent"
                >
                  {mvpRoomKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {roomKindLabels[kind]}
                    </option>
                  ))}
                </select>
              </div>
              {rooms.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setRooms((list) => list.filter((_, position) => position !== index))
                  }
                  className="h-11 px-2 text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-danger"
                >
                  Убрать
                </button>
              ) : null}
            </div>
          ))}
          {rooms.length < 8 ? (
            <button
              type="button"
              onClick={() =>
                setRooms((list) => [
                  ...list,
                  { key: roomKey(), kind: 'bedroom', name: 'Спальня', area: '' },
                ])
              }
              className="self-start text-sm text-accent underline decoration-line-strong underline-offset-4"
            >
              Добавить комнату
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'plan' ? (
        <p className="border border-dashed border-line-strong p-4 text-[15px] leading-relaxed text-ink-2">
          На следующем экране загрузим план: фотографию или PDF. Комнаты добавим после него, глядя
          на план.
        </p>
      ) : null}

      {mode === 'series' ? (
        <div className="flex flex-col gap-5">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Серия это типовой проект дома: у всех квартир одной серии одинаковая планировка. Обычно
            её пишут в объявлении о продаже или в документах на квартиру. Не знаете — выберите
            «Впишу комнаты сам», это ничем не хуже.
          </p>
          <div>
            <Label htmlFor="series">Серия дома</Label>
            <select
              id="series"
              value={seriesId}
              onChange={(event) => setSeriesId(event.target.value)}
              className="h-11 w-full border border-line-strong bg-paper px-3 text-[15px] text-ink outline-none transition-colors duration-200 ease-ui focus-visible:border-accent"
            >
              {houseSeries.map((series) => (
                <option key={series.id} value={series.id}>
                  {series.label}
                </option>
              ))}
            </select>
            <FieldHint id="series-hint">
              {houseSeries.find((series) => series.id === seriesId)?.hint}
            </FieldHint>
          </div>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 block text-xs font-medium uppercase tracking-[0.1em] text-ink-2">
              Сколько жилых комнат
            </legend>
            <div className="flex gap-2">
              {seriesRoomCounts.map((count) => (
                <label key={count} className="cursor-pointer">
                  <input
                    type="radio"
                    name="roomCount"
                    checked={roomCount === count}
                    onChange={() => setRoomCount(count)}
                    className="peer sr-only"
                  />
                  <span className="inline-flex h-9 w-12 items-center justify-center rounded-full border border-line-strong text-sm text-ink-2 transition-colors duration-200 ease-ui hover:text-ink peer-checked:border-accent peer-checked:text-ink">
                    {count}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {preview.length > 0 ? (
            <ul className="border border-line bg-paper px-4 py-3 text-[15px] text-ink-2">
              {preview.map((room) => (
                <li key={room.name} className="flex justify-between py-1">
                  <span className="text-ink">{room.name}</span>
                  <span className="font-mono text-[13px]">{formatArea(room.areaM2)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <FieldHint id="series-note">
            Площади примерные, поправите их на странице проекта.
          </FieldHint>
        </div>
      ) : null}

      {mode !== 'series' ? (
        <Input
          id="total-area"
          label="Площадь квартиры, м²"
          className="w-40"
          inputMode="decimal"
          value={totalArea}
          onChange={(event) => setTotalArea(event.target.value)}
          error={totalArea !== '' && parseArea(totalArea) === null ? 'Введите число' : undefined}
        />
      ) : null}

      <FormError message={error ?? undefined} />
      <div>
        <Button
          type="button"
          onClick={() => {
            if (title.trim() === '') {
              toast({ title: 'Дайте проекту название', tone: 'danger' })
              return
            }
            submit()
          }}
          disabled={pending}
        >
          {pending ? 'Создаём…' : 'Дальше'}
        </Button>
      </div>
    </div>
  )
}
