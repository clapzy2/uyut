'use client'

import { Button, type ButtonProps, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ActionResult, CheckoutResult } from '@/actions/billing'

/**
 * Кнопка оплаты: у ЮKassa уводит на страницу оплаты, у фейкового провайдера
 * оплата проходит сразу, и страница просто обновляется.
 */
export function CheckoutButton({
  action,
  children,
  pendingLabel = 'Переходим к оплате…',
  onPaid,
  ...props
}: Omit<ButtonProps, 'onClick' | 'pending'> & {
  action: () => Promise<ActionResult<CheckoutResult>>
  pendingLabel?: string
  onPaid?: (result: Extract<CheckoutResult, { next: 'paid' }>) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  function start() {
    setBusy(true)
    void action().then((result) => {
      if (!result.ok) {
        setBusy(false)
        toast({ title: result.error, tone: 'danger' })
        return
      }
      if (result.data.next === 'redirect') {
        window.location.assign(result.data.confirmationUrl)
        return
      }
      setBusy(false)
      if (result.data.next === 'paid') {
        toast({ title: 'Оплата прошла', tone: 'success' })
        onPaid?.(result.data)
        router.refresh()
        return
      }
      toast({ title: 'Платёж ещё обрабатывается. Обновите страницу через минуту.' })
    })
  }

  return (
    <Button {...props} onClick={start} pending={busy}>
      {busy ? pendingLabel : children}
    </Button>
  )
}
