import { randomUUID } from 'node:crypto'
import { type PlanReading, projectCollaborators, users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError, OwnerOnlyError } from './access'
import { PlanEditConflictError } from './plan-edit-revision'
import {
  createProject,
  deleteProject,
  getProject,
  setPlanReading,
  setProjectPlan,
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
