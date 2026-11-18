import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFurnitureReference } from '@/actions/furniture-reference'
import { readFurnitureReference } from './furniture-reference-token'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  room: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  preview: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/repository', () => ({ getRoom: mocks.room }))
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
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.room.mockResolvedValue(room)
  mocks.put.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue(undefined)
  mocks.preview.mockResolvedValue('https://example.test/private-preview')
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
  })
})
