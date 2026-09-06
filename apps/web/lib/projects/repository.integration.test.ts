import { randomUUID } from 'node:crypto'
import { users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from './access'
import {
  createProject,
  createRoom,
  deleteProject,
  deleteRoom,
  getProject,
  getRoom,
  listProjects,
  listRooms,
  updateProject,
  updateRoom,
} from './repository'

// Два пользователя в настоящей базе: доступ проверяется там же, где живут данные
const userIds: string[] = []

async function createUser(): Promise<string> {
  const [user] = await getDb()
    .insert(users)
    .values({ email: `isolation-${randomUUID()}@example.test`, displayName: 'Тест' })
    .returning({ id: users.id })
  if (!user) {
    throw new Error('user insert returned nothing')
  }
  userIds.push(user.id)
  return user.id
}

describe('project isolation between users', () => {
  let alice = ''
  let bob = ''
  let projectId = ''
  let roomId = ''

  beforeAll(async () => {
    alice = await createUser()
    bob = await createUser()
    const project = await createProject(alice, { title: 'Квартира Алисы' })
    projectId = project.id
    const room = await createRoom(alice, projectId, {
      kind: 'living',
      name: 'Гостиная',
      areaM2: 18.5,
    })
    roomId = room.id
  })

  afterAll(async () => {
    await getDb().delete(users).where(inArray(users.id, userIds))
  })

  it('shows the project only to its owner', async () => {
    expect((await listProjects(alice)).map((p) => p.id)).toContain(projectId)
    expect(await listProjects(bob)).toEqual([])
    await expect(getProject(bob, projectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(listRooms(bob, projectId)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('hides the room behind the same check', async () => {
    expect((await getRoom(alice, roomId)).name).toBe('Гостиная')
    await expect(getRoom(bob, roomId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateRoom(bob, roomId, { name: 'Чужая' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteRoom(bob, roomId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      createRoom(bob, projectId, { kind: 'kitchen', name: 'Кухня' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses edits and deletion by a stranger', async () => {
    await expect(updateProject(bob, projectId, { title: 'Взлом' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(deleteProject(bob, projectId)).rejects.toBeInstanceOf(NotFoundError)
    expect((await getProject(alice, projectId)).title).toBe('Квартира Алисы')
  })

  it('treats garbage ids as not found instead of crashing', async () => {
    await expect(getProject(alice, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError)
    await expect(getRoom(alice, '42')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('hides a deleted project from its own owner too', async () => {
    const { fileKeys } = await deleteProject(alice, projectId)
    expect(fileKeys).toEqual([])
    await expect(getProject(alice, projectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(getRoom(alice, roomId)).rejects.toBeInstanceOf(NotFoundError)
    expect(await listProjects(alice)).toEqual([])
  })
})
