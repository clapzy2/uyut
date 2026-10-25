'use client'

import { inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { resetItemOperationClearance, setItemOperationClearance } from '@/actions/shopping'

type OperationKind = 'front' | 'side' | 'around'

const COPY: Record<OperationKind, { label: string; hint: string }> = {
  front: {
    label: 'Запас перед предметом, см',
    hint: 'Для открытой дверцы, ящика, разложенной части или кресла у стола — сверх обычной глубины.',
  },
  side: {
    label: 'Свободно с каждого бока, см',
    hint: 'Точный подход к кровати или другой крупной мебели.',
  },
  around: {
    label: 'Свободно вокруг, см',
    hint: 'От края столешницы до стены или другой мебели, включая отодвинутый стул.',
  },
}

/** Одно измеренное число вместо скрытого «среднего» норматива. */
export function ItemOperationForm({
  itemId,
  title,
  kind,
  valueCm,
  guidance,
}: {
  itemId: string
  title: string
  kind: OperationKind
  valueCm?: number
  guidance?: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(valueCm ? String(valueCm) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const copy = COPY[kind]

  async function save(reset = false) {
    if (saving) return
    setError(undefined)
    setSaving(true)
    try {
      const result = reset
        ? await resetItemOperationClearance(itemId)
        : await setItemOperationClearance(itemId, {
            front: kind === 'front' ? value : '',
            side: kind === 'side' ? value : '',
            around: kind === 'around' ? value : '',
          })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (reset) setValue('')
      toast({
        title: reset ? 'Запас убран: рабочая зона требует уточнения' : 'Рабочая зона учтена',
        tone: 'success',
      })
      router.refresh()
    } catch {
      setError('Не удалось сохранить. Проверьте соединение и повторите.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
          <span className="mt-1 block text-[12px] leading-relaxed text-ink-2">{copy.label}</span>
          <input
            aria-label={`${copy.label}: ${title}`}
            inputMode="decimal"
            placeholder="уточнить"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            className={`${inputClassName} mt-2 h-9 w-28 text-[13px]`}
          />
        </label>
        <button
          type="button"
          onClick={() => save()}
          disabled={saving}
          className="inline-flex h-9 items-center rounded-full border border-control px-3 text-[13px] text-ink-2 transition-[color,border-color,transform] duration-200 ease-ui hover:border-ink hover:text-ink active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? 'Пишем…' : valueCm ? 'Обновить' : 'Учесть'}
        </button>
        {valueCm !== undefined ? (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving}
            className="inline-flex h-9 items-center border border-control px-3 text-[13px] text-ink-2 disabled:opacity-60"
          >
            Убрать запас
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{guidance ?? copy.hint}</p>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
  )
}
