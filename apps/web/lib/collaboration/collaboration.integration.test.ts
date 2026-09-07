import { randomUUID } from 'node:crypto'
import { users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { createProject, getProject, listProjects } from '@/lib/projects/repository'
import {
  acceptInvite,
  createInvite,
  findInvite,
  getCollaboration,
  hasPassword,
  InviteError,
  revokeCollaborator,
} from './repository'

// Приглашение в настоящей базе: токен, замена, принятие своим адресом, отзыв
const userIds: string[] = []

async function createUser(name: string, email = `it-invite-${randomUUID()}@example.test`) {
  const [user] = await getDb()
    .insert(users)
    .values({ email, displayName: name })
    .returning({ id: users.id, email: users.email })
  if (!user) {
    throw new Error('user insert returned nothing')
  }
  userIds.push(user.id)
  return user
}

describe('project invites', () => {
  let owner = { id: '', email: '' }
  let projectId = ''
  const partnerEmail = `it-invite-partner-${randomUUID()}@example.test`

  beforeAll(async () => {
    owner = await createUser('Аня')
    const project = await createProject(owner.id, { title: 'Квартира на Мира' })
    projectId = project.id
  })

  afterAll(async () => {
    await getDb().delete(users).where(inArray(users.id, userIds))
  })

  it('creates a pending invite and replaces it on resend', async () => {
    const first = await createInvite(owner.id, projectId, partnerEmail)
    expect(first.existingUser).toBe(false)
    expect(first.token.length).toBeGreaterThanOrEqual(24)
    expect((await findInvite(first.token))?.status).toBe('pending')

    const second = await createInvite(owner.id, projectId, partnerEmail)
    expect(await findInvite(first.token)).toBeNull()
    expect((await findInvite(second.token))?.inviterName).toBe('Аня')
    expect((await getCollaboration(projectId)).invite?.email).toBe(partnerEmail)
  })

  it('refuses the owner address and a foreign token holder', async () => {
    await expect(createInvite(owner.id, projectId, owner.email)).rejects.toBeInstanceOf(InviteError)
    const stranger = await createUser('Кто-то')
    const { token } = await createInvite(owner.id, projectId, partnerEmail)
    await expect(acceptInvite(stranger, token)).rejects.toBeInstanceOf(InviteError)
    await expect(acceptInvite(owner, 'no-such-token-at-all')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('adds the partner on accept and blocks a second one', async () => {
    const partner = await createUser('Маша', partnerEmail)
    const { token, existingUser } = await createInvite(owner.id, projectId, partnerEmail)
    expect(existingUser).toBe(true)
    expect(await hasPassword(partner.id)).toBe(false)

    const result = await acceptInvite(partner, token)
    expect(result).toMatchObject({ projectId, alreadyMember: false, ownerEmail: owner.email })
    expect((await getProject(partner.id, projectId)).role).toBe('partner')
    expect((await listProjects(partner.id)).map((item) => item.ownerName)).toEqual(['Аня'])
    expect((await findInvite(token))?.status).toBe('accepted')
    expect((await getCollaboration(projectId)).partner?.name).toBe('Маша')

    await expect(
      createInvite(owner.id, projectId, 'someone-else@example.test'),
    ).rejects.toBeInstanceOf(InviteError)
  })

  it('revokes access together with pending invites', async () => {
    const partnerId = userIds[userIds.length - 1] as string
    const { removedUserId } = await revokeCollaborator(owner.id, projectId)
    expect(removedUserId).toBe(partnerId)
    await expect(getProject(partnerId, projectId)).rejects.toBeInstanceOf(NotFoundError)
    expect(await getCollaboration(projectId)).toEqual({ partner: null, invite: null })
    await expect(revokeCollaborator(partnerId, projectId)).rejects.toBeInstanceOf(NotFoundError)
  })
})
