'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { getAuth } from '@/lib/auth'
import * as collaboration from '@/lib/collaboration/repository'
import { canInvite, INVITE_NEEDS_PLAN } from '@/lib/collaboration/rules'
import { getEmailSender, invitationLetter } from '@/lib/email'
import { getEnv } from '@/lib/env'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { getInvitesByUserLimiter } from '@/lib/redis'
import { getSession } from '@/lib/session'
import { emailSchema, passwordSchema } from '@/lib/validation/auth'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const inviteSchema = z.object({ projectId: z.uuid(), email: emailSchema })
const acceptSchema = z.object({
  token: z.string().min(16).max(128),
  password: z.preprocess((value) => (value === '' ? undefined : value), passwordSchema.optional()),
})

export type InviteInput = z.input<typeof inviteSchema>
export type AcceptInviteInput = z.input<typeof acceptSchema>

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AccessError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

/**
 * Пригласить второго участника. Без аккаунта человек входит по magic-link Better Auth,
 * с аккаунтом получает обычную ссылку и входит паролем: вход по ссылке для существующего
 * неподтверждённого аккаунта стёр бы его пароль.
 */
export async function inviteCollaborator(input: InviteInput): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте адрес' }
  }
  const { projectId, email } = parsed.data
  try {
    const project = await assertOwner(session.user.id, projectId)
    if (!(await canInvite(session.user.id, project))) {
      return { ok: false, error: INVITE_NEEDS_PLAN }
    }
    const { success } = await getInvitesByUserLimiter().limit(session.user.id)
    if (!success) {
      return { ok: false, error: 'Слишком много приглашений подряд. Попробуйте через час.' }
    }
    const created = await collaboration.createInvite(session.user.id, projectId, email)
    const requestHeaders = await headers()
    const inviterName = session.user.name || session.user.email.split('@')[0] || 'Владелец'
    const path = `/invites/${created.token}`
    if (created.existingUser) {
      await getEmailSender().send({
        to: email,
        ...invitationLetter({
          inviterName,
          projectTitle: created.projectTitle,
          url: new URL(path, getEnv().APP_URL).toString(),
        }),
      })
    } else {
      await getAuth().api.signInMagicLink({
        body: {
          email,
          callbackURL: path,
          newUserCallbackURL: path,
          errorCallbackURL: `${path}?error=link`,
          metadata: { inviteToken: created.token },
        },
        headers: requestHeaders,
      })
    }
    await recordAudit({
      action: 'collaborator.invited',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: requestHeaders,
      metadata: { inviteId: created.invite.id, existingUser: created.existingUser },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/** Принять приглашение; аккаунт из magic-link заодно получает пароль на будущее */
export async function acceptInvite(
  input: AcceptInviteInput,
): Promise<ActionResult<{ projectId: string }>> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = acceptSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте пароль' }
  }
  const requestHeaders = await headers()
  try {
    if (parsed.data.password) {
      if (await collaboration.hasPassword(session.user.id)) {
        return { ok: false, error: 'У этого аккаунта уже есть пароль.' }
      }
      await getAuth().api.setPassword({
        body: { newPassword: parsed.data.password },
        headers: requestHeaders,
      })
    }
    const result = await collaboration.acceptInvite(
      { id: session.user.id, email: session.user.email },
      parsed.data.token,
    )
    if (!result.alreadyMember) {
      await recordAudit({
        action: 'collaborator.accepted',
        actorId: session.user.id,
        targetType: 'project',
        targetId: result.projectId,
        headers: requestHeaders,
      })
    }
    revalidatePath('/projects')
    revalidatePath(`/projects/${result.projectId}`)
    return { ok: true, data: { projectId: result.projectId } }
  } catch (error) {
    return failure(error)
  }
}

export async function revokeCollaborator(projectId: string): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, error: 'Проект не найден' }
  }
  try {
    const { removedUserId } = await collaboration.revokeCollaborator(session.user.id, projectId)
    await recordAudit({
      action: 'collaborator.revoked',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { removedUserId },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}
