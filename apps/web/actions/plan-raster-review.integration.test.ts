import { randomUUID } from 'node:crypto'
import { type PlanReading, rooms, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import {
  createProject,
  getProject,
  setPlanReading,
  setProjectPlan,
} from '@/lib/projects/repository'

const local = vi.hoisted(() => ({ owner: '' }))
vi.mock('@/lib/session', () => ({ getSession: async () => ({ user: { id: local.owner } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn() }))
vi.mock('@/lib/projects/plan-reading', () => ({
  PlanReadError: class PlanReadError extends Error {},
  readPlanFromStorage: vi.fn(),
}))

import { confirmPlanRooms } from './projects'

const reading: PlanReading = {
  readAt: '2026-10-08',
  rooms: [{ name: 'Гостиная', kind: 'living', widthCm: 600, depthCm: 320 }],
}
const measured = {
  widthCm: 321,
  depthCm: 599,
  finishStage: 'after' as const,
  toleranceCm: 1,
  verification: {
    widthCm: 321,
    depthCm: 599,
    finishStage: 'after' as const,
    toleranceCm: 1,
    confirmedAt: '2026-10-08T00:00:00.000Z',
  },
}

describe('raster axis review through actions and PostgreSQL', () => {
  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname) ||
      !['5432', '58432'].includes(databaseUrl.port) ||
      !['/uyut', '/domitsa_ui_qa'].includes(databaseUrl.pathname)
    )
      throw new Error('Raster review integration requires a local PostgreSQL database')
    const [owner] = await getDb()
      .insert(users)
      .values({ email: `raster-review-${randomUUID()}@example.test`, displayName: 'Synthetic QA' })
      .returning({ id: users.id })
    if (!owner) throw new Error('QA owner was not created')
    local.owner = owner.id
  })

  afterAll(async () => {
    if (local.owner) await getDb().delete(users).where(eq(users.id, local.owner))
  })

  async function fixture(extension: string) {
    const project = await createProject(local.owner, { title: 'Synthetic raster review' })
    await setProjectPlan(local.owner, project.id, `qa/review.${extension}`, project)
    await setPlanReading(
      local.owner,
      project.id,
      reading,
      await getProject(local.owner, project.id),
    )
    const [room] = await getDb()
      .insert(rooms)
      .values({ projectId: project.id, name: 'Гостиная', kind: 'living', measurements: measured })
      .returning({ id: rooms.id })
    if (!room) throw new Error('QA room was not created')
    const current = await getProject(local.owner, project.id)
    return {
      projectId: project.id,
      revision: planEditRevision(current.planUrl, current.planReading),
      input: {
        condition: 'bare',
        ceilingCm: '',
        rooms: [
          {
            include: true,
            roomId: room.id,
            name: 'Гостиная',
            kind: 'living',
            widthCm: '600',
            depthCm: '320',
            areaM2: '',
            wish: '',
          },
        ],
      },
    }
  }

  it('rejects an unreviewed raster without changing the reading or existing measured room', async () => {
    const control = await fixture('png')
    expect(
      await confirmPlanRooms(control.projectId, control.input, control.revision),
    ).toMatchObject({
      ok: false,
    })
    const saved = await getProject(local.owner, control.projectId)
    expect(saved.planReading).toEqual(reading)
    expect(saved.rooms[0]?.measurements).toEqual(measured)
  })

  it('preserves existing sizes and physical verification when axes are explicitly omitted', async () => {
    const control = await fixture('webp')
    const input = {
      ...control.input,
      rooms: control.input.rooms.map((room) => ({ ...room, widthCm: '', depthCm: '' })),
    }
    expect(await confirmPlanRooms(control.projectId, input, control.revision)).toMatchObject({
      ok: true,
    })
    const saved = await getProject(local.owner, control.projectId)
    expect(saved.rooms[0]?.measurements).toEqual(measured)
    expect(saved.planReading?.rooms[0]).not.toHaveProperty('widthCm')
    expect(saved.planReading?.rooms[0]).not.toHaveProperty('depthCm')
  })

  it('keeps the legacy PDF transfer path available without raster acknowledgment flags', async () => {
    const control = await fixture('pdf')
    expect(
      await confirmPlanRooms(control.projectId, control.input, control.revision),
    ).toMatchObject({
      ok: true,
    })
    const saved = await getProject(local.owner, control.projectId)
    expect(saved.rooms[0]?.measurements).toMatchObject({ widthCm: 600, depthCm: 320 })
    expect(saved.rooms[0]?.measurements).not.toHaveProperty('verification')
  })
})
