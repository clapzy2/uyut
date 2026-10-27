import { randomUUID } from 'node:crypto'
import { users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import {
  claimRoomForGeneration,
  createProject,
  createRoom,
  getRoom,
  setRoomPhoto,
} from '@/lib/projects/repository'

const mocks = vi.hoisted(() => ({ session: vi.fn(), put: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/storage', () => ({ putObject: mocks.put, deleteObject: mocks.remove }))

import { uploadRoomPhoto } from './rooms'

describe('замена фото при активной генерации', () => {
  let owner = ''
  let projectId = ''

  beforeAll(async () => {
    const [user] = await getDb()
      .insert(users)
      .values({ email: `photo-replace-${randomUUID()}@example.test` })
      .returning()
    if (!user) throw new Error('Нет тестового пользователя')
    owner = user.id
    projectId = (await createProject(owner, { title: 'Проверка замены фото' })).id
    mocks.session.mockResolvedValue({ user: { id: owner } })
  })

  afterAll(async () => {
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })

  it('не удаляет прежнее фото и убирает новый файл при отказе', async () => {
    const room = await createRoom(owner, projectId, { name: 'Гостиная', kind: 'living' })
    await setRoomPhoto(owner, room.id, 'previous.webp')
    await claimRoomForGeneration(room.id, randomUUID())
    mocks.put.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)

    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } })
      .jpeg()
      .toBuffer()
    const form = new FormData()
    form.set('photo', new File([jpg], 'room.jpg', { type: 'image/jpeg' }))
    const result = await uploadRoomPhoto(room.id, form)

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('сейчас создаются варианты'),
    })
    const uploadedKey = mocks.put.mock.calls.at(-1)?.[0]
    expect(uploadedKey).toEqual(expect.stringContaining(`/rooms/${room.id}/photo/`))
    expect(mocks.remove).toHaveBeenCalledWith(uploadedKey)
    expect(mocks.remove).not.toHaveBeenCalledWith('previous.webp')
    const saved = await getRoom(owner, room.id)
    expect(saved.photoUrl).toBe('previous.webp')
    expect(saved.photoRevision).toBe(1)
  })
})
