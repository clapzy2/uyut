import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detachFurnitureReference,
  loadSavedFurnitureReference,
  uploadFurnitureReference,
} from '@/actions/furniture-reference'
import { AccessError } from '@/lib/projects/access'
import { readFurnitureReference, signFurnitureReference } from './furniture-reference-token'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  room: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/repository', () => ({ getRoom: mocks.room }))
vi.mock('@/lib/projects/furniture-reference', () => ({ saveFurnitureReference: mocks.save }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ BETTER_AUTH_SECRET: 'test-secret' }) }))
vi.mock('@/lib/storage', () => ({
  putObject: mocks.put,
  deleteObject: mocks.remove,
  presignedObjectUrl: mocks.preview,
}))

const room = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000001',
  photoUrl: 'original.webp',
  photoRevision: 3,
  condition: 'keep',
  role: 'owner',
  generationRunId: null,
  furnitureReference: null,
}

const savedKey = `projects/${room.projectId}/rooms/${room.id}/furniture-references/30000000-0000-4000-8000-000000000001.webp`
const savedReference = { key: savedKey, photoRevision: 3 }

function savedToken(photoRevision = 3) {
  return signFurnitureReference(
    'test-secret',
    { userId: 'owner', roomId: room.id, photoRevision },
    savedKey,
  )
}

async function form() {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
  const data = new FormData()
  data.set('photo', new File([new Uint8Array(bytes)], 'cabinet.png', { type: 'image/png' }))
  data.set('photoRevision', '3')
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.room.mockResolvedValue(room)
  mocks.put.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue(undefined)
  mocks.preview.mockResolvedValue('https://example.test/private-preview')
  mocks.save.mockResolvedValue({ previousKey: null })
})

describe('original furniture photo upload', () => {
  it('requires login before accepting files', async () => {
    mocks.session.mockResolvedValue(null)
    expect(await uploadFurnitureReference(room.id, await form())).toMatchObject({ ok: false })
    expect(mocks.room).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it.each([
    { ...room, role: 'partner' },
    { ...room, photoRevision: 4 },
    { ...room, photoUrl: null },
    { ...room, condition: 'finished' },
    { ...room, generationRunId: 'running' },
  ])('rejects wrong access or room state before upload', async (state) => {
    mocks.room.mockResolvedValue(state)
    expect(await uploadFurnitureReference(room.id, await form())).toMatchObject({ ok: false })
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it.each(['-1', '', '3.5', '3junk'])('rejects malformed revision %s', async (revision) => {
    const data = await form()
    data.set('photoRevision', revision)
    expect(await uploadFurnitureReference(room.id, data)).toMatchObject({ ok: false })
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it.each([new File([], 'empty.png'), new File(['not a photo'], 'bad.png')])(
    'rejects empty or non-image content',
    async (file) => {
      const data = await form()
      data.set('photo', file)
      expect(await uploadFurnitureReference(room.id, data)).toMatchObject({ ok: false })
      expect(mocks.put).not.toHaveBeenCalled()
    },
  )

  it('normalizes the upload and signs a unique room-scoped key', async () => {
    const result = await uploadFurnitureReference(room.id, await form())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected successful upload')
    const [key, bytes, contentType] = mocks.put.mock.calls[0] ?? []
    expect(key).toMatch(
      new RegExp(
        `^projects/${room.projectId}/rooms/${room.id}/furniture-references/[0-9a-f-]+\\.webp$`,
      ),
    )
    expect(contentType).toBe('image/webp')
    expect((await sharp(bytes).metadata()).format).toBe('webp')
    expect(mocks.save).toHaveBeenCalledWith('owner', room.id, 3, { key, photoRevision: 3 }, null)
    expect(
      readFurnitureReference(
        'test-secret',
        { userId: 'owner', roomId: room.id, photoRevision: 3 },
        result.data.token,
      ),
    ).toEqual({ key, photoRevision: 3 })
  })

  it('removes only the newly uploaded object if room photo changes during upload', async () => {
    mocks.room.mockResolvedValueOnce(room).mockResolvedValueOnce({ ...room, photoRevision: 4 })
    expect(await uploadFurnitureReference(room.id, await form())).toMatchObject({ ok: false })
    expect(mocks.remove).toHaveBeenCalledWith(mocks.put.mock.calls[0]?.[0])
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('replaces the saved reference using its original key as the concurrency guard', async () => {
    mocks.room.mockResolvedValue({ ...room, furnitureReference: savedReference })
    expect(await uploadFurnitureReference(room.id, await form())).toMatchObject({ ok: true })
    const key = mocks.put.mock.calls[0]?.[0]
    expect(mocks.save).toHaveBeenCalledWith(
      'owner',
      room.id,
      3,
      { key, photoRevision: 3 },
      savedKey,
    )
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('cleans up only the new upload when another tab replaces the reference first', async () => {
    mocks.room.mockResolvedValue({ ...room, furnitureReference: savedReference })
    mocks.save.mockRejectedValue(new AccessError('Образец уже изменён. Обновите страницу.'))
    expect(await uploadFurnitureReference(room.id, await form())).toEqual({
      ok: false,
      error: 'Образец уже изменён. Обновите страницу.',
    })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(mocks.put.mock.calls[0]?.[0])
    expect(mocks.remove).not.toHaveBeenCalledWith(savedKey)
  })
})

describe('saved furniture reference', () => {
  it('restores a private preview and a new signed receipt for the current photo', async () => {
    mocks.room.mockResolvedValue({ ...room, furnitureReference: savedReference })
    const result = await loadSavedFurnitureReference(room.id)
    expect(result).toMatchObject({
      previewUrl: 'https://example.test/private-preview',
    })
    expect(
      readFurnitureReference(
        'test-secret',
        { userId: 'owner', roomId: room.id, photoRevision: 3 },
        result?.token ?? '',
      ),
    ).toEqual(savedReference)
    expect(mocks.preview).toHaveBeenCalledWith(savedKey, 3600)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('does not load a reference without a session', async () => {
    mocks.session.mockResolvedValue(null)
    expect(await loadSavedFurnitureReference(room.id)).toBeNull()
    expect(mocks.room).not.toHaveBeenCalled()
  })

  it.each([
    room,
    { ...room, furnitureReference: { ...savedReference, photoRevision: 2 } },
    { ...room, furnitureReference: savedReference, photoUrl: null },
    { ...room, furnitureReference: savedReference, condition: 'finished' },
  ])('does not restore a missing or outdated reference', async (state) => {
    mocks.room.mockResolvedValue(state)
    expect(await loadSavedFurnitureReference(room.id)).toBeNull()
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('does not disclose the reference preview to a partner', async () => {
    mocks.room.mockResolvedValue({ ...room, role: 'partner', furnitureReference: savedReference })
    await expect(loadSavedFurnitureReference(room.id)).rejects.toThrow(AccessError)
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('detaches only the reference named in the receipt without deleting its object', async () => {
    mocks.room.mockResolvedValue({ ...room, furnitureReference: savedReference })
    expect(await detachFurnitureReference(room.id, savedToken())).toEqual({ ok: true })
    expect(mocks.save).toHaveBeenCalledWith('owner', room.id, 3, null, savedKey)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('reports a detach conflict instead of clearing a reference replaced in another tab', async () => {
    mocks.save.mockRejectedValue(new AccessError('Образец уже изменён. Обновите страницу.'))
    expect(await detachFurnitureReference(room.id, savedToken())).toEqual({
      ok: false,
      error: 'Образец уже изменён. Обновите страницу.',
    })
    expect(mocks.save).toHaveBeenCalledWith('owner', room.id, 3, null, savedKey)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it.each(['invalid-token', savedToken(2)])(
    'rejects an invalid or stale detach receipt',
    async (token) => {
      expect(await detachFurnitureReference(room.id, token)).toMatchObject({ ok: false })
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it('does not detach without login', async () => {
    mocks.session.mockResolvedValue(null)
    expect(await detachFurnitureReference(room.id, savedToken())).toMatchObject({ ok: false })
    expect(mocks.room).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
