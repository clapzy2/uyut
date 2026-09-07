import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { clientIpFromHeaders, recordAudit } from '@/lib/audit'
import { applyPayment } from '@/lib/billing/apply'
import { getEnv } from '@/lib/env'
import { isYooKassaAddress } from '@/lib/payments'

export const dynamic = 'force-dynamic'

// Формат уведомления ЮKassa: событие и объект платежа; из объекта нам нужен только id
const notificationSchema = z.object({
  type: z.literal('notification'),
  event: z.string(),
  object: z.object({ id: z.string().min(1) }),
})

/**
 * У ЮKassa нет подписи уведомлений, поэтому телу не доверяем: по id перечитываем платёж из API,
 * а адрес отправителя сверяем со списком подсетей ЮKassa. В бою чужой адрес отклоняется;
 * в разработке уведомления приходят через туннель, поэтому проверка только пишется в аудит.
 */
export async function POST(request: NextRequest) {
  // Адрес разобрал прокси по цепочке X-Forwarded-For: сырой заголовок клиент подделает сам
  const ip = clientIpFromHeaders(request.headers)
  const trusted = ip !== null && isYooKassaAddress(ip)
  const production = getEnv().NODE_ENV === 'production'

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }
  const parsed = notificationSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'bad notification' }, { status: 400 })
  }
  const { event, object } = parsed.data

  if (!trusted && production) {
    await recordAudit({
      action: 'billing.webhook_rejected',
      targetType: 'payment',
      metadata: { event, paymentId: object.id, ip },
    })
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!event.startsWith('payment.')) {
    await recordAudit({
      action: 'billing.webhook',
      targetType: 'payment',
      metadata: { event, paymentId: object.id, ip, trusted, handled: false },
    })
    return Response.json({ ok: true, handled: false })
  }

  const result = await applyPayment(object.id)
  await recordAudit({
    action: 'billing.webhook',
    actorId: result.purchase?.userId ?? null,
    targetType: 'purchase',
    targetId: result.purchase?.id,
    metadata: {
      event,
      paymentId: object.id,
      ip,
      trusted,
      handled: true,
      applied: result.applied,
      status: result.status,
    },
  })
  return Response.json({ ok: true, applied: result.applied })
}
