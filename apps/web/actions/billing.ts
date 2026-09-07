'use server'

import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { applyPayment } from '@/lib/billing/apply'
import { attachPayment, createPurchase, getPurchase } from '@/lib/billing/repository'
import { getEnv } from '@/lib/env'
import type { ExportRun } from '@/lib/exports/start'
import { getPaymentProvider } from '@/lib/payments'
import { AccessError, assertOwner, isUuid } from '@/lib/projects/access'
import { getPaymentsByUserLimiter } from '@/lib/redis'
import { getSession } from '@/lib/session'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const TOO_MANY = 'Слишком много попыток оплаты подряд. Попробуйте через час.'

/** Что делать клиенту дальше: перейти к оплате или сразу показать результат */
export type CheckoutResult =
  | { next: 'redirect'; purchaseId: string; confirmationUrl: string }
  | { next: 'paid'; purchaseId: string; exportRun?: ExportRun }
  | { next: 'pending'; purchaseId: string }

async function currentUser(): Promise<{ id: string; email: string } | null> {
  const session = await getSession()
  return session ? { id: session.user.id, email: session.user.email } : null
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AccessError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

async function checkout(input: {
  userId: string
  kind: 'project' | 'pro'
  projectId: string | null
  amountKopecks: number
  description: string
  returnPath: string
  savePaymentMethod?: boolean
}): Promise<CheckoutResult> {
  const purchase = await createPurchase({
    userId: input.userId,
    kind: input.kind,
    projectId: input.projectId,
    amountKopecks: input.amountKopecks,
  })
  const returnUrl = new URL(input.returnPath, getEnv().APP_URL)
  returnUrl.searchParams.set('payment', purchase.id)
  const payment = await getPaymentProvider().createPayment({
    amountKopecks: input.amountKopecks,
    description: input.description,
    returnUrl: returnUrl.toString(),
    idempotencyKey: purchase.id,
    metadata: { purchaseId: purchase.id, kind: input.kind, userId: input.userId },
    ...(input.savePaymentMethod ? { savePaymentMethod: true } : {}),
  })
  await attachPayment(purchase.id, payment.id)
  await recordAudit({
    action: 'billing.purchase_started',
    actorId: input.userId,
    targetType: 'purchase',
    targetId: purchase.id,
    metadata: {
      kind: input.kind,
      projectId: input.projectId,
      amountKopecks: input.amountKopecks,
      paymentId: payment.id,
      provider: getPaymentProvider().name,
    },
  })
  if (payment.confirmationUrl && payment.status !== 'succeeded') {
    return { next: 'redirect', purchaseId: purchase.id, confirmationUrl: payment.confirmationUrl }
  }
  // Фейковый провайдер отвечает успехом сразу: применяем платёж тем же путём, что и webhook
  const applied = await applyPayment(payment.id)
  if (applied.status === 'succeeded') {
    return { next: 'paid', purchaseId: purchase.id, exportRun: applied.exportRun }
  }
  return { next: 'pending', purchaseId: purchase.id }
}

/** «Забрать проект»: разовая покупка одной квартиры */
export async function startProjectPurchase(
  projectId: string,
): Promise<ActionResult<CheckoutResult>> {
  const user = await currentUser()
  if (!user) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const project = await assertOwner(user.id, projectId)
    if (project.isPaid) {
      return { ok: false, error: 'Этот проект уже оплачен.' }
    }
    const { success } = await getPaymentsByUserLimiter().limit(user.id)
    if (!success) {
      return { ok: false, error: TOO_MANY }
    }
    const result = await checkout({
      userId: user.id,
      kind: 'project',
      projectId: project.id,
      amountKopecks: getEnv().PROJECT_PRICE_KOPECKS,
      description: `Uyut: проект «${project.title}»`,
      returnPath: `/projects/${project.id}/summary`,
    })
    revalidatePath(`/projects/${project.id}/summary`)
    return { ok: true, data: result }
  } catch (error) {
    return failure(error)
  }
}

/** Месяц Pro: без ограничений на число проектов и без водяного знака */
export async function startProSubscription(
  returnPath = '/projects',
): Promise<ActionResult<CheckoutResult>> {
  const user = await currentUser()
  if (!user) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const { success } = await getPaymentsByUserLimiter().limit(user.id)
    if (!success) {
      return { ok: false, error: TOO_MANY }
    }
    const safePath =
      returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/projects'
    const result = await checkout({
      userId: user.id,
      kind: 'pro',
      projectId: null,
      amountKopecks: getEnv().PRO_PRICE_KOPECKS,
      description: 'Uyut Pro, один месяц',
      returnPath: safePath,
      savePaymentMethod: true,
    })
    revalidatePath('/projects')
    return { ok: true, data: result }
  } catch (error) {
    return failure(error)
  }
}

/** Страница возврата: пользователь вернулся от провайдера, проверяем платёж заново */
export async function settlePurchase(
  purchaseId: string,
): Promise<ActionResult<{ status: 'paid' | 'pending' | 'canceled'; exportRun?: ExportRun }>> {
  const user = await currentUser()
  if (!user) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  if (!isUuid(purchaseId)) {
    return { ok: false, error: 'Платёж не найден' }
  }
  try {
    const purchase = await getPurchase(user.id, purchaseId)
    if (purchase.status === 'paid') {
      return { ok: true, data: { status: 'paid' } }
    }
    if (!purchase.yukassaPaymentId) {
      return { ok: true, data: { status: 'pending' } }
    }
    const applied = await applyPayment(purchase.yukassaPaymentId)
    if (applied.status === 'succeeded') {
      if (purchase.projectId) {
        revalidatePath(`/projects/${purchase.projectId}/summary`)
      }
      revalidatePath('/projects')
      return { ok: true, data: { status: 'paid', exportRun: applied.exportRun } }
    }
    return { ok: true, data: { status: applied.status === 'canceled' ? 'canceled' : 'pending' } }
  } catch (error) {
    return failure(error)
  }
}
