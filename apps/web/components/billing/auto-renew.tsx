'use client'

import { toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setProAutoRenew } from '@/actions/billing'
import { formatPrice } from '@/lib/concepts/format'
import { formatDate } from '@/lib/projects/format'

/**
 * Строка состояния подписки: до какого числа работает Pro и будет ли следующее списание.
 * Отключение доступно в один клик, потому что согласие на ежемесячную оплату должно
 * так же легко отзываться, как и даваться.
 */
export function AutoRenewNote({
  periodEnd,
  autoRenew,
  hasSavedMethod,
  priceKopecks,
}: {
  periodEnd: Date
  autoRenew: boolean
  hasSavedMethod: boolean
  priceKopecks: number
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(autoRenew)
  const [busy, setBusy] = useState(false)

  function toggle() {
    const next = !enabled
    setBusy(true)
    void setProAutoRenew(next).then((result) => {
      setBusy(false)
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      setEnabled(result.data.autoRenew)
      toast({
        title: result.data.autoRenew ? 'Будем продлевать автоматически' : 'Автопродление отключено',
      })
      router.refresh()
    })
  }

  return (
    <p className="mt-2 font-mono text-[13px] text-ink-2">
      Pro до {formatDate(periodEnd)} ·{' '}
      {enabled ? `дальше ${formatPrice(priceKopecks)} в месяц` : 'без автопродления'}
      {enabled || hasSavedMethod ? (
        <>
          {' · '}
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="underline decoration-line-strong decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-ink disabled:opacity-50"
          >
            {enabled ? 'отключить' : 'включить'}
          </button>
        </>
      ) : null}
    </p>
  )
}
