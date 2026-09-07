'use client'

import { startProSubscription } from '@/actions/billing'
import { CheckoutButton } from '@/components/billing/checkout-button'
import { formatPrice } from '@/lib/concepts/format'

/** Подписка заканчивается: одна оплата продлевает её на месяц, автосписаний нет */
export function ProRenewal({
  priceKopecks,
  returnPath,
}: {
  priceKopecks: number
  returnPath: string
}) {
  return (
    <CheckoutButton
      action={() => startProSubscription(returnPath)}
      pendingLabel="Переходим к оплате…"
    >
      Продлить Pro за {formatPrice(priceKopecks)}
    </CheckoutButton>
  )
}

/** Второй проект в бесплатном плане закрыт: предлагаем Pro вместо кнопки «Новый проект» */
export function ProUpsell({
  priceKopecks,
  returnPath,
}: {
  priceKopecks: number
  returnPath: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="max-w-xs text-[13px] leading-relaxed text-ink-2">
        В бесплатном плане один проект. Pro снимает ограничение и убирает водяной знак с PDF.
      </p>
      <CheckoutButton
        variant="secondary"
        action={() => startProSubscription(returnPath)}
        pendingLabel="Переходим к оплате…"
      >
        Оформить Pro за {formatPrice(priceKopecks)} в месяц
      </CheckoutButton>
    </div>
  )
}
