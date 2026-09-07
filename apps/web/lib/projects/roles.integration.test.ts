import { randomUUID } from 'node:crypto'
import { concepts, projectCollaborators, users } from '@uyut/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setConceptLike } from '@/lib/concepts/repository'
import { getDb } from '@/lib/db'
import { NotFoundError, OwnerOnlyError, ProjectClosedError } from './access'
import {
  createProject,
  createRoom,
  deleteProject,
  deleteRoom,
  getProject,
  getRoom,
  listProjects,
  updateProject,
  updateRoom,
} from './repository'

// Второй участник проекта в настоящей базе: читает всё, меняет ничего
const userIds: string[] = []

async function createUser(name: string): Promise<string> {
  const [user] = await getDb()
    .insert(users)
    .values({ email: `it-roles-${randomUUID()}@example.test`, displayName: name })
    .returning({ id: users.id })
  if (!user) {
    throw new Error('user insert returned nothing')
  }
  userIds.push(user.id)
  return user.id
}

describe('project roles', () => {
  let owner = ''
  let partner = ''
  let stranger = ''
  let projectId = ''
  let roomId = ''
  let conceptId = ''

  beforeAll(async () => {
    owner = await createUser('Аня')
    partner = await createUser('Маша')
    stranger = await createUser('Кто-то')
    const project = await createProject(owner, { title: 'Квартира на двоих' })
    projectId = project.id
    const room = await createRoom(owner, projectId, { kind: 'living', name: 'Гостиная' })
    roomId = room.id
    await getDb().insert(projectCollaborators).values({
      projectId,
      userId: partner,
      role: 'partner',
      acceptedAt: new Date(),
    })
    const [concept] = await getDb()
      .insert(concepts)
      .values({
        roomId,
        batchId: randomUUID(),
        status: 'ready',
        prompt: 'test',
        aiModel: 'test',
      })
      .returning({ id: concepts.id })
    conceptId = concept?.id ?? ''
  })

  afterAll(async () => {
    await getDb().delete(users).where(inArray(users.id, userIds))
  })

  it('shows the project to the partner with their role', async () => {
    expect((await getProject(owner, projectId)).role).toBe('owner')
    expect((await getProject(partner, projectId)).role).toBe('partner')
    expect((await getRoom(partner, roomId)).role).toBe('partner')
    await expect(getProject(stranger, projectId)).rejects.toBeInstanceOf(NotFoundError)

    const listed = await listProjects(partner)
    expect(listed.map((item) => [item.id, item.role, item.ownerName])).toEqual([
      [projectId, 'partner', 'Аня'],
    ])
    expect((await listProjects(owner)).map((item) => item.role)).toEqual(['owner'])
  })

  it('keeps every change owner-only', async () => {
    await expect(updateProject(partner, projectId, { title: 'Моё' })).rejects.toBeInstanceOf(
      OwnerOnlyError,
    )
    await expect(
      createRoom(partner, projectId, { kind: 'kitchen', name: 'Кухня' }),
    ).rejects.toBeInstanceOf(OwnerOnlyError)
    await expect(updateRoom(partner, roomId, { name: 'Зал' })).rejects.toBeInstanceOf(
      OwnerOnlyError,
    )
    await expect(deleteRoom(partner, roomId)).rejects.toBeInstanceOf(OwnerOnlyError)
    await expect(deleteProject(partner, projectId)).rejects.toBeInstanceOf(OwnerOnlyError)
    expect((await getProject(owner, projectId)).title).toBe('Квартира на двоих')
  })

  it('writes likes into the column of the voter', async () => {
    await setConceptLike(partner, conceptId, true)
    await setConceptLike(owner, conceptId, false)
    const [row] = await getDb().select().from(concepts).where(eq(concepts.id, conceptId))
    expect(row?.likedByPartner).toBe(true)
    expect(row?.likedByOwner).toBe(false)
    await expect(setConceptLike(stranger, conceptId, true)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('tells the partner when the owner closed the project', async () => {
    await deleteProject(owner, projectId)
    await expect(getProject(partner, projectId)).rejects.toBeInstanceOf(ProjectClosedError)
    await expect(getRoom(partner, roomId)).rejects.toBeInstanceOf(ProjectClosedError)
    await expect(getProject(stranger, projectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(getProject(owner, projectId)).rejects.toBeInstanceOf(NotFoundError)
    expect(await listProjects(partner)).toEqual([])
  })
})
