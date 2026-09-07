import { createHash, randomBytes } from 'node:crypto'
import {
  accounts,
  type ProjectInvite,
  projectCollaborators,
  projectInvites,
  projects,
  users,
} from '@uyut/db'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { AccessError, assertOwner, NotFoundError } from '@/lib/projects/access'

const DAY_MS = 24 * 60 * 60 * 1000
export const INVITE_TTL_DAYS = 7

export class InviteError extends AccessError {
  constructor(message: string) {
    super(message)
    this.name = 'InviteError'
  }
}

/** В базе лежит только хэш: утечка таблицы не даёт войти по чужому приглашению */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type PartnerView = {
  userId: string
  name: string
  email: string
  acceptedAt: Date | null
}

export type PendingInviteView = {
  email: string
  expiresAt: Date
}

export type CollaborationView = {
  partner: PartnerView | null
  invite: PendingInviteView | null
}

/** Кого владелец видит в блоке «Вдвоём»: принятого участника или висящее приглашение */
export async function getCollaboration(projectId: string): Promise<CollaborationView> {
  const db = getDb()
  const [partnerRow] = await db
    .select({
      userId: projectCollaborators.userId,
      acceptedAt: projectCollaborators.acceptedAt,
      name: users.displayName,
      email: users.email,
    })
    .from(projectCollaborators)
    .innerJoin(users, eq(users.id, projectCollaborators.userId))
    .where(
      and(eq(projectCollaborators.projectId, projectId), eq(projectCollaborators.role, 'partner')),
    )
    .limit(1)
  const [inviteRow] = await db
    .select({ email: projectInvites.email, expiresAt: projectInvites.expiresAt })
    .from(projectInvites)
    .where(
      and(
        eq(projectInvites.projectId, projectId),
        isNull(projectInvites.acceptedAt),
        gt(projectInvites.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return {
    partner: partnerRow
      ? {
          userId: partnerRow.userId,
          name: partnerRow.name ?? partnerRow.email.split('@')[0] ?? 'второй участник',
          email: partnerRow.email,
          acceptedAt: partnerRow.acceptedAt,
        }
      : null,
    invite: inviteRow ?? null,
  }
}

export type CreatedInvite = {
  token: string
  invite: ProjectInvite
  projectTitle: string
  /** У адресата уже есть аккаунт: ему хватит обычной ссылки, magic-link не нужен */
  existingUser: boolean
}

/**
 * Одно приглашение на проект: новое заменяет висящее. Пока второй участник в проекте,
 * пригласить ещё кого-то нельзя, сначала владелец отзывает доступ.
 */
export async function createInvite(
  userId: string,
  projectId: string,
  email: string,
): Promise<CreatedInvite> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (owner?.email === email) {
    throw new InviteError('Это ваш собственный адрес: пригласите кого-то ещё.')
  }
  const current = await getCollaboration(project.id)
  if (current.partner) {
    throw new InviteError(
      `В проекте уже есть ${current.partner.name}. Чтобы пригласить кого-то ещё, сначала отзовите доступ.`,
    )
  }
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  const token = randomBytes(24).toString('base64url')
  const [invite] = await db.transaction(async (tx) => {
    await tx
      .delete(projectInvites)
      .where(and(eq(projectInvites.projectId, project.id), isNull(projectInvites.acceptedAt)))
    return tx
      .insert(projectInvites)
      .values({
        projectId: project.id,
        email,
        invitedBy: userId,
        tokenHash: hashInviteToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS),
      })
      .returning()
  })
  if (!invite) {
    throw new Error('invite insert returned nothing')
  }
  return { token, invite, projectTitle: project.title, existingUser: Boolean(existing) }
}

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'closed'

export type InviteLookup = ProjectInvite & {
  projectTitle: string
  inviterName: string
  status: InviteStatus
}

/** Приглашение по токену из письма вместе с его состоянием: страница объясняет, что случилось */
export async function findInvite(token: string): Promise<InviteLookup | null> {
  const [row] = await getDb()
    .select({
      invite: projectInvites,
      projectTitle: projects.title,
      projectDeletedAt: projects.deletedAt,
      inviterName: users.displayName,
    })
    .from(projectInvites)
    .innerJoin(projects, eq(projects.id, projectInvites.projectId))
    .innerJoin(users, eq(users.id, projectInvites.invitedBy))
    .where(eq(projectInvites.tokenHash, hashInviteToken(token)))
    .limit(1)
  if (!row) {
    return null
  }
  const status: InviteStatus = row.projectDeletedAt
    ? 'closed'
    : row.invite.acceptedAt
      ? 'accepted'
      : row.invite.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'pending'
  return {
    ...row.invite,
    projectTitle: row.projectTitle,
    inviterName: row.inviterName ?? 'владелец проекта',
    status,
  }
}

export type AcceptResult = { projectId: string; alreadyMember: boolean }

/**
 * Принять приглашение: адрес сессии должен совпасть с адресом из письма, иначе чужая
 * ссылка ничего не даёт. Повторное принятие ничего не ломает.
 */
export async function acceptInvite(
  user: { id: string; email: string },
  token: string,
): Promise<AcceptResult> {
  const invite = await findInvite(token)
  if (invite?.status !== 'pending') {
    throw new NotFoundError('Приглашение не найдено или устарело.')
  }
  if (invite.email !== user.email.toLowerCase()) {
    throw new InviteError('Приглашение отправлено на другой адрес. Войдите под ним.')
  }
  if (invite.invitedBy === user.id) {
    throw new InviteError('Это ваш проект: приглашение предназначено второму участнику.')
  }
  const db = getDb()
  const [member] = await db
    .select({ id: projectCollaborators.id })
    .from(projectCollaborators)
    .where(
      and(
        eq(projectCollaborators.projectId, invite.projectId),
        eq(projectCollaborators.userId, user.id),
      ),
    )
    .limit(1)
  await db.transaction(async (tx) => {
    if (!member) {
      await tx.insert(projectCollaborators).values({
        projectId: invite.projectId,
        userId: user.id,
        role: 'partner',
        invitedAt: invite.createdAt,
        acceptedAt: new Date(),
      })
    }
    await tx
      .update(projectInvites)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(eq(projectInvites.id, invite.id))
  })
  return { projectId: invite.projectId, alreadyMember: Boolean(member) }
}

/** Отозвать доступ: убирает и принятого участника, и висящее приглашение */
export async function revokeCollaborator(
  userId: string,
  projectId: string,
): Promise<{ removedUserId: string | null }> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(projectCollaborators)
      .where(
        and(
          eq(projectCollaborators.projectId, project.id),
          eq(projectCollaborators.role, 'partner'),
        ),
      )
      .returning({ userId: projectCollaborators.userId })
    await tx
      .delete(projectInvites)
      .where(and(eq(projectInvites.projectId, project.id), isNull(projectInvites.acceptedAt)))
    return rows[0]?.userId ?? null
  })
  return { removedUserId: removed }
}

/** Аккаунт из magic-link живёт без пароля, пока человек его не задаст */
export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .limit(1)
  return Boolean(row)
}
