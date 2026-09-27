import { randomUUID } from 'node:crypto'
import { type PlanReading, projectCollaborators, users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError, OwnerOnlyError } from './access'
import { PlanEditConflictError } from './plan-edit-revision'
import {
  createProject,
  createRoom,
  createRoomsFromPlan,
  deleteProject,
  deleteRoom,
  getProject,
  setPlanReading,
  setProjectPlan,
  updateRoom,
} from './repository'

const reading: PlanReading = {
  readAt: '2026-09-27T00:00:00Z',
  rooms: [{ name: 'Спальня', kind: 'bedroom', widthCm: 400, depthCm: 300 }],
  geometry: {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm: 400,
    heightCm: 300,
    walls: [],
    openings: [],
    rooms: [],
    warnings: [],
  },
}
const userIds: string[] = []

describe('atomic owner-scoped plan editing', () => {
  let owner = ''
  let partner = ''
  let stranger = ''

  beforeAll(async () => {
    for (const name of ['owner', 'partner', 'stranger']) {
      const [user] = await getDb()
        .insert(users)
        .values({
          email: `plan-edit-${name}-${randomUUID()}@example.test`,
          displayName: name,
        })
        .returning({ id: users.id })
      if (!user) throw new Error('Missing test user')
      userIds.push(user.id)
    }
    const [ownerId, partnerId, strangerId] = userIds
    if (!ownerId || !partnerId || !strangerId) throw new Error('Missing test users')
    owner = ownerId
    partner = partnerId
    stranger = strangerId
  })

  afterAll(async () => {
    if (userIds.length) await getDb().delete(users).where(inArray(users.id, userIds))
  })

  async function fixture(withReading = true) {
    const project = await createProject(owner, { title: 'Синтетический тест 2D' })
    await setProjectPlan(owner, project.id, 'qa/plan.webp')
    if (withReading) await setPlanReading(owner, project.id, reading)
    return getProject(owner, project.id)
  }

  function confirmation(roomId?: string) {
    return {
      reading: { ...reading, confirmedAt: new Date().toISOString() },
      rooms: [
        {
          ...(roomId ? { roomId } : {}),
          name: 'Спальня',
          kind: 'bedroom' as const,
          condition: 'bare' as const,
          areaM2: 12,
          measurements: { widthCm: 400, depthCm: 300 },
          notes: null,
        },
      ],
    }
  }

  it('creates rooms once when two confirmations share the same source', async () => {
    const source = await fixture()
    const input = confirmation()
    const results = await Promise.allSettled([
      createRoomsFromPlan(owner, source.id, input, source),
      createRoomsFromPlan(owner, source.id, input, source),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await getProject(owner, source.id)).rooms).toHaveLength(1)
    await expect(createRoomsFromPlan(owner, source.id, input, source)).rejects.toBeInstanceOf(
      PlanEditConflictError,
    )
  })

  it('cannot confirm old rooms after the plan file was replaced', async () => {
    const source = await fixture()
    await setProjectPlan(owner, source.id, 'qa/new-plan.webp')
    await expect(
      createRoomsFromPlan(owner, source.id, confirmation(), source),
    ).rejects.toBeInstanceOf(PlanEditConflictError)
    const current = await getProject(owner, source.id)
    expect(current.planUrl).toBe('qa/new-plan.webp')
    expect(current.planReading).toBeNull()
    expect(current.rooms).toEqual([])
  })

  it('rolls back newly inserted rooms when updating another room fails', async () => {
    const source = await fixture()
    const existing = await createRoom(owner, source.id, { name: 'Детская', kind: 'kid' })
    const input = confirmation()
    const first = input.rooms[0]
    if (!first) throw new Error('Missing test room')
    // Намеренно нарушаем NOT NULL после вставки новой комнаты, чтобы проверить откат.
    input.rooms.push({ ...first, roomId: existing.id, name: null as unknown as string })
    await expect(createRoomsFromPlan(owner, source.id, input, source)).rejects.toThrow()
    const current = await getProject(owner, source.id)
    expect(current.rooms.map((room) => room.id)).toEqual([existing.id])
    expect(current.rooms[0]?.kind).toBe('kid')
    expect(current.planReading).toEqual(source.planReading)
  })

  it('does not recreate a removed room or silently replace a foreign room id', async () => {
    const source = await fixture()
    const removed = await createRoom(owner, source.id, { name: 'Спальня', kind: 'bedroom' })
    await deleteRoom(owner, removed.id)
    await expect(
      createRoomsFromPlan(owner, source.id, confirmation(removed.id), source),
    ).rejects.toBeInstanceOf(PlanEditConflictError)
    const otherProject = await createProject(stranger, { title: 'Чужой синтетический проект' })
    const otherRoom = await createRoom(stranger, otherProject.id, {
      name: 'Спальня',
      kind: 'bedroom',
    })
    await expect(
      createRoomsFromPlan(owner, source.id, confirmation(otherRoom.id), source),
    ).rejects.toBeInstanceOf(PlanEditConflictError)
    expect((await getProject(stranger, otherProject.id)).rooms[0]?.name).toBe('Спальня')
    expect((await getProject(owner, source.id)).rooms).toEqual([])
    expect((await getProject(owner, source.id)).planReading).toEqual(reading)
  })

  it('allows one replacement from a source snapshot and keeps existing room measurements', async () => {
    const source = await fixture()
    const room = await createRoom(owner, source.id, { name: 'Спальня', kind: 'bedroom' })
    await updateRoom(owner, room.id, {
      measurements: { widthCm: 395, spots: [{ name: 'ниша', widthCm: 120 }] },
    })
    const results = await Promise.allSettled([
      setProjectPlan(owner, source.id, 'qa/replacement-a.webp', source),
      setProjectPlan(owner, source.id, 'qa/replacement-b.webp', source),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const current = await getProject(owner, source.id)
    expect(current.planReading).toBeNull()
    expect(current.rooms[0]?.measurements).toMatchObject({
      widthCm: 395,
      spots: [{ name: 'ниша', widthCm: 120 }],
    })
  })

  it('preserves measured niches, wishes and condition while importing newly confirmed sides', async () => {
    const source = await fixture()
    const room = await createRoom(owner, source.id, {
      name: 'Спальня',
      kind: 'bedroom',
      condition: 'finished',
    })
    await updateRoom(owner, room.id, {
      notes: 'Оставить шкаф',
      measurements: {
        widthCm: 395,
        depthCm: 300,
        finishStage: 'after',
        toleranceCm: 0.5,
        spots: [{ name: 'ниша', widthCm: 120 }],
        verification: {
          widthCm: 395,
          depthCm: 300,
          finishStage: 'after',
          toleranceCm: 0.5,
          confirmedAt: '2026-09-27T00:00:00Z',
        },
      },
    })
    await createRoomsFromPlan(owner, source.id, confirmation(room.id), source)
    const current = (await getProject(owner, source.id)).rooms[0]
    expect(current?.condition).toBe('finished')
    expect(current?.notes).toBe('Оставить шкаф')
    expect(current?.measurements).toMatchObject({
      widthCm: 400,
      depthCm: 300,
      spots: [{ name: 'ниша', widthCm: 120 }],
      finishStage: 'unknown',
    })
    expect(current?.measurements).not.toHaveProperty('verification')
    expect(current?.measurements).not.toHaveProperty('toleranceCm')
  })

  it('allows only one of two competing writes from the same source snapshot', async () => {
    const source = await fixture()
    const edits = ['первая правка', 'вторая правка'].map((note) => ({
      ...reading,
      geometry: reading.geometry ? { ...reading.geometry, warnings: [note] } : undefined,
    }))
    const results = await Promise.allSettled(
      edits.map((edit) => setPlanReading(owner, source.id, edit, source)),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(PlanEditConflictError)
    const winner = results.findIndex((result) => result.status === 'fulfilled')
    expect((await getProject(owner, source.id)).planReading).toEqual(edits[winner])
  })

  it('does not attach a stale scheme to a replacement file', async () => {
    const source = await fixture()
    await setProjectPlan(owner, source.id, 'qa/replacement.webp')
    await expect(setPlanReading(owner, source.id, reading, source)).rejects.toBeInstanceOf(
      PlanEditConflictError,
    )
    const current = await getProject(owner, source.id)
    expect(current.planUrl).toBe('qa/replacement.webp')
    expect(current.planReading).toBeNull()
  })

  it('rejects stale rooms, then permits retry from the freshly loaded source', async () => {
    const source = await fixture()
    const corrected = {
      ...reading,
      rooms: [{ name: 'Спальня', kind: 'bedroom' as const, widthCm: 360 }],
    }
    await setPlanReading(owner, source.id, corrected)
    await expect(setPlanReading(owner, source.id, reading, source)).rejects.toBeInstanceOf(
      PlanEditConflictError,
    )
    const current = await getProject(owner, source.id)
    const next = { ...corrected, geometry: undefined }
    await setPlanReading(owner, source.id, next, current)
    expect((await getProject(owner, source.id)).planReading).toEqual(next)
  })

  it('compares JSONB content rather than object key order', async () => {
    const source = await fixture()
    const reordered: PlanReading = {
      geometry: reading.geometry,
      rooms: reading.rooms,
      readAt: reading.readAt,
    }
    await setPlanReading(owner, source.id, reading, {
      planUrl: source.planUrl,
      planReading: reordered,
    })
    expect((await getProject(owner, source.id)).planReading).toEqual(reading)
  })

  it('does not let two manual starts overwrite each other when there is no reading yet', async () => {
    const source = await fixture(false)
    const results = await Promise.allSettled([
      setPlanReading(owner, source.id, reading, source),
      setPlanReading(owner, source.id, { ...reading, rooms: [] }, source),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('rejects partner, stranger and deleted-project writes without changing the plan', async () => {
    const source = await fixture()
    await getDb()
      .insert(projectCollaborators)
      .values({ projectId: source.id, userId: partner, role: 'partner' })
    await expect(setPlanReading(partner, source.id, null, source)).rejects.toBeInstanceOf(
      OwnerOnlyError,
    )
    await expect(
      createRoomsFromPlan(partner, source.id, confirmation(), source),
    ).rejects.toBeInstanceOf(OwnerOnlyError)
    await expect(setPlanReading(stranger, source.id, null, source)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await getProject(owner, source.id)).planReading).toEqual(reading)
    await deleteProject(owner, source.id)
    await expect(setPlanReading(owner, source.id, null, source)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})
