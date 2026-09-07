import type { Purchase } from '@uyut/db'
import { recordAudit } from '@/lib/audit'
import {
  activatePro,
  findPurchaseByPayment,
  markProjectPaid,
  markPurchasePaid,
  userEmail,
} from '@/lib/billing/repository'
import { getEnv } from '@/lib/env'
import { type ExportRun, startExport } from '@/lib/exports/start'
import { getPaymentProvider, type PaymentStatus } from '@/lib/payments'

export type ApplyResult = {
  /** Покупка переведена в paid именно этим вызовом */
  applied: boolean
  purchase: Purchase | null
  status: PaymentStatus | 'unknown'
  /** Сборка чистого PDF, запущенная после оплаты проекта */
  exportRun?: ExportRun
}

/**
 * Единственное место, где оплата становится фактом. Статус платежа перечитывается из API
 * провайдера, а не берётся из уведомления; переход pending → paid делается одним update
 * с условием, поэтому webhook, возврат на сайт и повторные уведомления безопасно
 * вызывают эту функцию сколько угодно раз.
 */
export async function applyPayment(paymentId: string): Promise<ApplyResult> {
  const payment = await getPaymentProvider().getPayment(paymentId)
  if (!payment) {
    return { applied: false, purchase: null, status: 'unknown' }
  }
  const purchase = await findPurchaseByPayment(paymentId)
  if (!purchase) {
    return { applied: false, purchase: null, status: payment.status }
  }
  if (payment.status !== 'succeeded' || !payment.paid) {
    return { applied: false, purchase, status: payment.status }
  }
  if (payment.amountKopecks !== purchase.amountKopecks) {
    await recordAudit({
      action: 'billing.amount_mismatch',
      actorId: purchase.userId,
      targetType: 'purchase',
      targetId: purchase.id,
      metadata: { paymentId, expected: purchase.amountKopecks, actual: payment.amountKopecks },
    })
    return { applied: false, purchase, status: payment.status }
  }
  const changed = await markPurchasePaid(purchase.id)
  if (!changed) {
    return { applied: false, purchase: { ...purchase, status: 'paid' }, status: 'succeeded' }
  }

  if (purchase.kind === 'project' && purchase.projectId) {
    await markProjectPaid(purchase.projectId)
  } else {
    await activatePro(purchase.userId, payment.paymentMethodId ?? null)
  }
  await recordAudit({
    action: 'billing.paid',
    actorId: purchase.userId,
    targetType: 'purchase',
    targetId: purchase.id,
    metadata: {
      paymentId,
      kind: purchase.kind,
      projectId: purchase.projectId,
      amountKopecks: purchase.amountKopecks,
      provider: getPaymentProvider().name,
    },
  })

  // Чистый PDF и письмо со ссылкой: сборка идёт в очереди, письмо уходит по её завершении.
  // Если очередь недоступна, оплата всё равно засчитана — документ соберут кнопкой позже.
  let exportRun: ExportRun | undefined
  if (purchase.kind === 'project' && purchase.projectId && getEnv().TRIGGER_SECRET_KEY) {
    try {
      const email = await userEmail(purchase.userId)
      exportRun = await startExport(purchase.userId, purchase.projectId, {
        ...(email ? { notifyEmail: email } : {}),
      })
    } catch (error) {
      console.error('paid export did not start', error)
    }
  }
  return {
    applied: true,
    purchase: { ...purchase, status: 'paid' },
    status: 'succeeded',
    exportRun,
  }
}
