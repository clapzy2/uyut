'use client'

import { inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setItemSize } from '@/actions/shopping'

/**
 * Габариты товара со слов человека.
 *
 * В фиде их часто нет: у диванов размеры нашлись у одного товара из четырёхсот шестидесяти двух.
 * Без них вид сверху молчит про самый крупный предмет комнаты, а переписать два числа
 * с карточки магазина — пять секунд. Форма стоит там же, где сказано, что размеров не хватает.
 */
export function ItemSizeForm({
  itemId,
  title,
  width,
  depth,
}: {
  itemId: string
  title: string
  width?: number
  depth?: number
}) {
  const router = useRouter()
  const [own, setOwn] = useState({
    width: width ? String(width) : '',
    depth: depth ? String(depth) : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function save() {
    setError(undefined)
    setSaving(true)
    const result = await setItemSize(itemId, { ...own, height: '' })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({ title: 'Размеры записаны', tone: 'success' })
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{title}</span>
      <input
        aria-label={`Ширина, см: ${title}`}
        inputMode="numeric"
        placeholder="ширина"
        value={own.width}
        onChange={(event) => setOwn((all) => ({ ...all, width: event.currentTarget.value }))}
        className={`${inputClassName} h-9 w-24 text-[13px]`}
      />
      <input
        aria-label={`Глубина, см: ${title}`}
        inputMode="numeric"
        placeholder="глубина"
        value={own.depth}
        onChange={(event) => setOwn((all) => ({ ...all, depth: event.currentTarget.value }))}
        className={`${inputClassName} h-9 w-24 text-[13px]`}
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex h-9 items-center rounded-full border border-control px-3 text-[13px] text-ink-2 transition-[color,border-color,transform] duration-200 ease-ui hover:border-ink hover:text-ink active:scale-[0.98] disabled:opacity-60"
      >
        {saving ? 'Пишем…' : 'Записать'}
      </button>
      {error ? <span className="w-full text-[13px] text-danger">{error}</span> : null}
    </div>
  )
}
