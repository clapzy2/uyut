import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveFurnitureReference } from './furniture-reference'

const mocks = vi.hoisted(() => ({
  room: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
  saved: vi.fn(),
  returning: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ getDb: () => ({ update: mocks.update }) }))
vi.mock('./repository', () => ({ getRoom: mocks.room }))
const key = 'projects/project/rooms/room/furniture-references/new.webp'
const reference = { key, photoRevision: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.room.mockResolvedValue({ id: 'room', projectId: 'project', role: 'owner' })
  mocks.returning.mockResolvedValue([{ id: 'room' }])
  mocks.where.mockReturnValue({ returning: mocks.returning })
  mocks.saved.mockReturnValue({ where: mocks.where })
  mocks.update.mockReturnValue({ set: mocks.saved })
})

describe('сохранённый образец мебели', () => {
  it('сохраняет только при той же ревизии, свободной комнате и прежнем ключе', async () => {
    expect(await saveFurnitureReference('owner', 'room', 2, reference, null)).toEqual({
      previousKey: null,
    })
    expect(mocks.saved).toHaveBeenCalledWith({ furnitureReference: reference })
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]?.[0])
    expect(query.sql).toContain('"photo_revision"')
    expect(query.sql).toContain('"generation_run_id" is null')
    expect(query.sql).toContain('"photo_url" is not null')
    expect(query.sql).toContain("->>'key' is not distinct from")
    expect(query.params).toEqual(expect.arrayContaining([2, 'keep', null]))
  })
  it('удаление также проверяет ключ ранее показанного образца', async () => {
    await saveFurnitureReference('owner', 'room', 2, null, key)
    expect(mocks.saved).toHaveBeenCalledWith({ furnitureReference: null })
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]?.[0])
    expect(query.params).toContain(key)
  })
  it('не затирает обновлённый в другой вкладке образец', async () => {
    mocks.returning.mockResolvedValue([])
    await expect(saveFurnitureReference('owner', 'room', 2, reference, 'previous')).rejects.toThrow(
      'Обновите страницу',
    )
  })
  it('не записывает образец от другого фото или комнаты', async () => {
    await expect(
      saveFurnitureReference('owner', 'room', 2, { ...reference, photoRevision: 3 }, null),
    ).rejects.toThrow('Образец не относится')
    await expect(
      saveFurnitureReference(
        'owner',
        'room',
        2,
        { ...reference, key: 'projects/other/rooms/other/furniture-references/new.webp' },
        null,
      ),
    ).rejects.toThrow('Образец не относится')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('участник без прав владельца не меняет образец', async () => {
    mocks.room.mockResolvedValue({ id: 'room', projectId: 'project', role: 'partner' })
    await expect(saveFurnitureReference('partner', 'room', 2, reference, null)).rejects.toThrow(
      'владелец',
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
