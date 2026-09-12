import { auditLog } from '@uyut/db'
import { getDb } from './db'
import { CLIENT_IP_HEADER } from './security/client-ip'

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.email_verified'
  | 'profile.updated'
  | 'profile.avatar_changed'
  | 'project.created'
  | 'project.deleted'
  | 'project.plan_read'
  | 'project.plan_rooms'
  | 'onboarding.completed'
  | 'concepts.requested'
  | 'concept.recolored'
  | 'chat.message'
  | 'chat.tool'
  | 'shopping.item_added'
  | 'shopping.item_updated'
  | 'shopping.item_removed'
  | 'export.requested'
  | 'billing.purchase_started'
  | 'billing.paid'
  | 'billing.amount_mismatch'
  | 'billing.webhook'
  | 'billing.webhook_rejected'
  | 'billing.autopay_charged'
  | 'billing.autopay_failed'
  | 'billing.autopay_changed'
  | 'billing.subscription_expired'
  | 'collaborator.invited'
  | 'collaborator.accepted'
  | 'collaborator.revoked'

type AuditInput = {
  action: AuditAction
  actorId?: string | null
  targetType?: string
  targetId?: string
  headers?: Headers
  metadata?: Record<string, unknown>
}

// Заголовок ставит прокси Next.js, разобрав цепочку X-Forwarded-For: сырым заголовкам веры нет
export function clientIpFromHeaders(headers: Headers | undefined): string | null {
  return headers?.get(CLIENT_IP_HEADER) ?? null
}

// Аудит не должен ронять пользовательский запрос: ошибка записи только логируется
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await getDb()
      .insert(auditLog)
      .values({
        action: input.action,
        actorId: input.actorId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: clientIpFromHeaders(input.headers),
        userAgent: input.headers?.get('user-agent') ?? null,
        metadata: input.metadata ?? null,
      })
  } catch (error) {
    console.error('audit log write failed', error)
  }
}
