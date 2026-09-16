'use client'

import { inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setItemPlacement } from '@/actions/shopping'

export function ItemPlacementForm({
  itemId,
  title,
  widthCm,
  depthCm,
  xCm,
  yCm,
  rotation,
  frontDirection,
  operationKind,
}: {
  itemId: string
  title: string
  widthCm: number
  depthCm: number
  xCm?: number
  yCm?: number
  rotation: 0 | 90
  frontDirection?: 'up' | 'right' | 'down' | 'left'
  operationKind?: 'front' | 'side' | 'around'
}) {
  const router = useRouter()
  const [value, setValue] = useState({
    xCm: xCm === undefined ? '' : String(xCm),
    yCm: yCm === undefined ? '' : String(yCm),
    rotation: String(rotation) as '0' | '90',
    frontDirection: frontDirection ?? 'auto',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const exact = xCm !== undefined && yCm !== undefined

  async function run(input: unknown, success: string) {
    setSaving(true)
    setError(undefined)
    const result = await setItemPlacement(itemId, input)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({ title: success, tone: 'success' })
    router.refresh()
  }

  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{title}</p>
          <p className="mt-1 text-[12px] text-ink-2">
            Габарит {Math.round(widthCm)} × {Math.round(depthCm)} см
          </p>
        </div>
        <label>
          <span className="block text-[11px] text-ink-2">Слева, см</span>
          <input
            aria-label={`Отступ слева, см: ${title}`}
            inputMode="numeric"
            value={value.xCm}
            onChange={(event) => setValue((all) => ({ ...all, xCm: event.currentTarget.value }))}
            className={`${inputClassName} mt-1 h-9 w-24 text-[13px]`}
          />
        </label>
        {operationKind && operationKind !== 'around' ? (
          <label>
            <span className="block text-[11px] text-ink-2">
              {operationKind === 'front' ? 'Рабочая сторона' : 'Ориентация'}
            </span>
            <select
              aria-label={`Рабочая сторона: ${title}`}
              value={value.frontDirection}
              onChange={(event) =>
                setValue((all) => ({
                  ...all,
                  frontDirection: event.currentTarget.value as typeof all.frontDirection,
                }))
              }
              className={`${inputClassName} mt-1 h-9 w-32 text-[13px]`}
            >
              <option value="auto">от стены</option>
              <option value="up">вверх ↑</option>
              <option value="right">вправо →</option>
              <option value="down">вниз ↓</option>
              <option value="left">влево ←</option>
            </select>
          </label>
        ) : null}
        <label>
          <span className="block text-[11px] text-ink-2">Сверху, см</span>
          <input
            aria-label={`Отступ сверху, см: ${title}`}
            inputMode="numeric"
            value={value.yCm}
            onChange={(event) => setValue((all) => ({ ...all, yCm: event.currentTarget.value }))}
            className={`${inputClassName} mt-1 h-9 w-24 text-[13px]`}
          />
        </label>
        <label>
          <span className="block text-[11px] text-ink-2">Поворот</span>
          <select
            aria-label={`Поворот: ${title}`}
            value={value.rotation}
            onChange={(event) =>
              setValue((all) => ({ ...all, rotation: event.currentTarget.value as '0' | '90' }))
            }
            className={`${inputClassName} mt-1 h-9 w-24 text-[13px]`}
          >
            <option value="0">0°</option>
            <option value="90">90°</option>
          </select>
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            void run(
              { mode: 'exact', ...value },
              exact ? 'Положение обновлено' : 'Место закреплено',
            )
          }
          className="inline-flex h-9 items-center rounded-full border border-control px-3 text-[13px] text-ink-2 transition-[color,border-color,transform] duration-200 ease-ui hover:border-ink hover:text-ink active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? 'Пишем…' : exact ? 'Обновить' : 'Закрепить'}
        </button>
        {exact ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void run({ mode: 'auto' }, 'Автоматическая расстановка включена')}
            className="h-9 px-2 text-[12px] text-accent underline decoration-accent/40 underline-offset-4 disabled:opacity-60"
          >
            ставить автоматически
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
  )
}
