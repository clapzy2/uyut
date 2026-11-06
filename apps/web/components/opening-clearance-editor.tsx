'use client'

import type { PlanOpening } from '@uyut/db'
import { useId, useState } from 'react'

type Clearance = NonNullable<PlanOpening['clearance']>
type Draft = {
  side: '' | Clearance['side']
  shape: '' | 'rectangle' | 'swing'
  hinge: '' | 'start' | 'end'
  depth: string
}

export function clearanceFromDraft(draft: Draft): Clearance | undefined {
  const depthCm = Number(draft.depth.replace(',', '.'))
  if (
    !draft.side ||
    !draft.shape ||
    !draft.depth.trim() ||
    !Number.isFinite(depthCm) ||
    depthCm <= 0 ||
    depthCm > 600 ||
    (draft.shape === 'swing' && !draft.hinge)
  )
    return undefined
  return {
    side: draft.side,
    shape: draft.shape,
    depthCm,
    ...(draft.shape === 'swing' && draft.hinge ? { hinge: draft.hinge } : {}),
  }
}

export function OpeningClearanceEditor({
  value,
  onChange,
}: {
  value: PlanOpening['clearance']
  onChange: (value: PlanOpening['clearance']) => void
}) {
  // Applying, removing or externally replacing a zone starts a fresh field draft.
  return (
    <ClearanceFields key={JSON.stringify(value) ?? 'empty'} value={value} onChange={onChange} />
  )
}

function ClearanceFields({ value, onChange }: Parameters<typeof OpeningClearanceEditor>[0]) {
  const id = useId()
  const initial: Draft = {
    side: value?.side ?? '',
    shape: value ? (value.shape ?? 'rectangle') : '',
    hinge: value?.hinge ?? '',
    depth: value ? String(value.depthCm) : '',
  }
  const [draft, setDraft] = useState(initial)
  const changed = JSON.stringify(draft) !== JSON.stringify(initial)
  const complete = clearanceFromDraft(draft)
  const control = 'mt-1 block w-full border border-control bg-paper p-2 text-sm'
  const patch = (update: Partial<Draft>) => setDraft((current) => ({ ...current, ...update }))

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm" htmlFor={`${id}-side`}>
          Куда открывается
        </label>
        <select
          id={`${id}-side`}
          className={control}
          value={draft.side}
          onChange={(event) => patch({ side: event.currentTarget.value as Draft['side'] })}
        >
          <option value="">Не указано</option>
          <option value="left">Сторона А - слева от направления стены</option>
          <option value="right">Сторона Б - справа от направления стены</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm" htmlFor={`${id}-shape`}>
            Форма зоны
          </label>
          <select
            id={`${id}-shape`}
            className={control}
            value={draft.shape}
            onChange={(event) => patch({ shape: event.currentTarget.value as Draft['shape'] })}
          >
            <option value="">Не указана</option>
            <option value="swing">Дуга створки 90°</option>
            <option value="rectangle">Прямоугольный резерв</option>
          </select>
        </div>
        {draft.shape === 'swing' ? (
          <div>
            <label className="block text-sm" htmlFor={`${id}-hinge`}>
              Петли
            </label>
            <select
              id={`${id}-hinge`}
              className={control}
              value={draft.hinge}
              onChange={(event) => patch({ hinge: event.currentTarget.value as Draft['hinge'] })}
            >
              <option value="">Не указаны</option>
              <option value="start">В начале проёма</option>
              <option value="end">В конце проёма</option>
            </select>
          </div>
        ) : null}
      </div>
      <div>
        <label className="block text-sm" htmlFor={`${id}-depth`}>
          {draft.shape === 'swing' ? 'Длина створки, см' : 'Глубина свободной зоны, см'}
        </label>
        <input
          id={`${id}-depth`}
          className={control}
          inputMode="decimal"
          placeholder="Уточнить по источнику или обмеру"
          value={draft.depth}
          onChange={(event) => patch({ depth: event.currentTarget.value })}
        />
      </div>
      <p className="text-xs leading-relaxed text-ink-2">
        Ширина проёма не равна длине створки. Для дуги выбранный конец проёма должен совпадать с
        осью петель. Если ось не известна, уточните её или задайте измеренный прямоугольный резерв.
        Сервис не подставляет размеры и положение петель.
      </p>
      {changed ? (
        <p role="status" className="text-sm text-ink-2">
          Изменения зоны ещё не применены.{' '}
          {value ? 'На схеме пока остаётся прежняя зона.' : 'Зона открывания пока неизвестна.'}{' '}
          Заполните поля, примените зону, затем сохраните схему.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!complete || !changed}
          className="border border-control px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => {
            if (!complete) return
            setDraft({
              side: complete.side,
              shape: complete.shape ?? 'rectangle',
              hinge: complete.hinge ?? '',
              depth: String(complete.depthCm),
            })
            onChange(complete)
          }}
        >
          Применить зону
        </button>
        {value ? (
          <button
            type="button"
            className="border border-control px-3 py-2 text-sm"
            onClick={() => onChange(undefined)}
          >
            Убрать зону
          </button>
        ) : null}
      </div>
    </div>
  )
}
