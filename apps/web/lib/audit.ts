import { auditLog } from '@uyut/db'
import { getDb } from './db'

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

type AuditInput = {
  action: AuditAction
  actorId?: string | null
  targetType?: string
  targetId?: string
  headers?: Headers
  metadata?: Record<string, unknown>
}

export function clientIpFromHeaders(headers: Headers | undefined): string | null {
  const forwarded = headers?.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? null
  }
  return headers?.get('x-real-ip') ?? null
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
