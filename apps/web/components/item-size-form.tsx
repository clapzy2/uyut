'use client'

import { inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { resetItemSize, setItemSize } from '@/actions/shopping'

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
  height,
  canReset = false,
}: {
  itemId: string
  title: string
  width?: number
  depth?: number
  height?: number
  canReset?: boolean
}) {
  const router = useRouter()
  const [refreshing, startTransition] = useTransition()
  const [own, setOwn] = useState({
    width: width ? String(width) : '',
    depth: depth ? String(depth) : '',
    height: height ? String(height) : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    setOwn({
      width: width === undefined ? '' : String(width),
      depth: depth === undefined ? '' : String(depth),
      height: height === undefined ? '' : String(height),
    })
  }, [width, depth, height])

  async function save() {
    if (saving || refreshing) return
    setError(undefined)
    setSaving(true)
    try {
      const result = await setItemSize(itemId, own)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast({ title: 'Ваши габариты сохранены', tone: 'success' })
      startTransition(() => router.refresh())
    } catch {
      setError('Не удалось сохранить. Проверьте соединение и повторите.')
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (saving || refreshing) return
    setError(undefined)
    setSaving(true)
    try {
      const result = await resetItemSize(itemId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOwn({ width: '', depth: '', height: '' })
      toast({
        title: 'Ваши габариты убраны; данные магазина используются, если они указаны',
        tone: 'success',
      })
      startTransition(() => router.refresh())
    } catch {
      setError('Не удалось сбросить размеры. Проверьте соединение и повторите.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{title}</span>
      <input
        aria-label={`Ширина, см: ${title}`}
        inputMode="decimal"
        placeholder="ширина"
        value={own.width}
        onChange={(event) => setOwn((all) => ({ ...all, width: event.currentTarget.value }))}
        className={`${inputClassName} h-9 w-24 text-[13px]`}
      />
      <input
        aria-label={`Глубина, см: ${title}`}
        inputMode="decimal"
        placeholder="глубина"
        value={own.depth}
        onChange={(event) => setOwn((all) => ({ ...all, depth: event.currentTarget.value }))}
        className={`${inputClassName} h-9 w-24 text-[13px]`}
      />
      <input
        aria-label={`Высота, см: ${title}`}
        inputMode="decimal"
        placeholder="высота"
        value={own.height}
        onChange={(event) => setOwn((all) => ({ ...all, height: event.currentTarget.value }))}
        className={`${inputClassName} h-9 w-24 text-[13px]`}
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || refreshing}
        className="inline-flex h-9 items-center rounded-full border border-control px-3 text-[13px] text-ink-2 transition-[color,border-color,transform] duration-200 ease-ui hover:border-ink hover:text-ink active:scale-[0.98] disabled:opacity-60"
      >
        {saving || refreshing ? 'Сохраняем…' : 'Сохранить свои размеры'}
      </button>
      {canReset ? (
        <button
          type="button"
          onClick={reset}
          disabled={saving || refreshing}
          className="h-9 px-1 text-[13px] text-accent underline underline-offset-4 disabled:opacity-60"
        >
          Убрать свои размеры
        </button>
      ) : null}
      {error ? <span className="w-full text-[13px] text-danger">{error}</span> : null}
    </div>
  )
}
