import { createHmac, timingSafeEqual } from 'node:crypto'
import type { EditPlan } from '@uyut/ai'
import { z } from 'zod'

const receiptSchema = z.object({
  userId: z.string(),
  conceptId: z.string(),
  request: z.string(),
  expiresAt: z.number(),
  plan: z.object({
    steps: z
      .array(z.object({ titleRu: z.string(), prompt: z.string(), needsObject: z.boolean() }))
      .max(4),
    warningRu: z.string(),
  }),
})
type EditContext = { userId: string; conceptId: string; request: string }

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(`concept-edit-plan:${payload}`).digest()
}

// Подпись связывает показанные шаги с просьбой и владельцем без второй оплаты модели.
// Токен не заменяет проверку доступа к концепту перед запуском.
export function signEditPlan(
  secret: string,
  context: EditContext,
  plan: EditPlan,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...context, plan, expiresAt: now + 30 * 60_000 }),
  ).toString('base64url')
  return `${payload}.${signature(secret, payload).toString('base64url')}`
}

export function readEditPlan(
  secret: string,
  context: EditContext,
  token: string,
  now = Date.now(),
): EditPlan | null {
  const [payload, mac, extra] = token.split('.')
  if (!payload || !mac || extra !== undefined) return null
  const actual = Buffer.from(mac, 'base64url')
  const expected = signature(secret, payload)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const receipt = receiptSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
    if (
      receipt.expiresAt <= now ||
      receipt.userId !== context.userId ||
      receipt.conceptId !== context.conceptId ||
      receipt.request !== context.request
    )
      return null
    return receipt.plan
  } catch {
    return null
  }
}
