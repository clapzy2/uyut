import type { PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  session: vi.fn(),
  read: vi.fn(),
  setReading: vi.fn(),
  createRooms: vi.fn(),
}))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.owner,
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/repository', () => ({
  setPlanReading: mocks.setReading,
  createRoomsFromPlan: mocks.createRooms,
}))
vi.mock('@/lib/projects/plan-reading', () => ({
  PlanReadError: class PlanReadError extends Error {},
  readPlanFromStorage: mocks.read,
}))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { confirmPlanRooms, readPlan } from './projects'

const projectId = 'f6fcb42e-2b4e-4b39-bb5c-31c9bfbe9f2f'
const reading: PlanReading = {
  planState: 'existing',
  sourcePage: 6,
  pageCount: 48,
  totalAreaM2: 74.77,
  readAt: '2026-09-26T00:00:00.000Z',
  rooms: [
    {
      name: 'Спальня 4',
      kind: 'bedroom',
      sourceNumber: 4,
      ceilingCm: 266.3,
      widthCm: 298.5,
      depthCm: 515.6,
      areaM2: 15.39,
    },
    {
      name: 'Спальня 6',
      kind: 'bedroom',
      sourceNumber: 6,
      ceilingCm: 267.2,
      widthCm: 294.5,
      depthCm: 415.4,
      areaM2: 12.23,
    },
  ],
}

function input(ceilingCm = '') {
  return {
    condition: 'bare',
    ceilingCm,
    rooms: reading.rooms.map((room) => ({
      include: true,
      roomId: '',
      name: room.name,
      kind: room.kind,
      sourceNumber: room.sourceNumber,
      ceilingCm: String(room.ceilingCm),
      widthCm: String(room.widthCm),
      depthCm: String(room.depthCm),
      areaM2: String(room.areaM2),
      wish: '',
    })),
  }
}

describe('plan reading actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: reading })
    mocks.read.mockResolvedValue(reading)
    mocks.createRooms.mockResolvedValue({ created: 2, updated: 0 })
  })

  it('passes the selected page through the owner-scoped action', async () => {
    expect((await readPlan(projectId, 6, planEditRevision('plan.pdf', reading))).ok).toBe(true)
    expect(mocks.read).toHaveBeenCalledWith('plan.pdf', 6)
    expect(mocks.setReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({ sourcePage: 6, pageCount: 48, planState: 'existing' }),
      { planUrl: 'plan.pdf', planReading: reading },
    )
  })

  it('does not read or save a document without an authenticated owner', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await readPlan(projectId, 6)).ok).toBe(false)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.setReading).not.toHaveBeenCalled()
  })

  it('preserves decimal dimensions, individual ceilings and sheet provenance on save', async () => {
    expect(
      (await confirmPlanRooms(projectId, input('270'), planEditRevision('plan.pdf', reading))).ok,
    ).toBe(true)
    const data = mocks.createRooms.mock.calls[0]?.[2]
    expect(data.reading).toMatchObject({
      sourcePage: 6,
      pageCount: 48,
      planState: 'existing',
      totalAreaM2: 74.77,
    })
    expect(data.reading.rooms[0]).toMatchObject({ sourceNumber: 4, ceilingCm: 266.3 })
    expect(data.rooms[0].measurements).toMatchObject({
      ceilingCm: 266.3,
      widthCm: 298.5,
      depthCm: 515.6,
    })
    expect(data.rooms[1].measurements.ceilingCm).toBe(267.2)
    expect(data.rooms[0].measurements).not.toHaveProperty('verification')
  })

  it('does not manufacture ceilings or sides when fields are empty', async () => {
    const data = input()
    const first = data.rooms[0]
    if (!first) throw new Error('Fixture has no rooms')
    data.rooms[0] = { ...first, ceilingCm: '', widthCm: '', depthCm: '' }
    expect(
      (await confirmPlanRooms(projectId, data, planEditRevision('plan.pdf', reading))).ok,
    ).toBe(true)
    const saved = mocks.createRooms.mock.calls[0]?.[2]
    expect(saved.rooms[0].measurements).not.toHaveProperty('ceilingCm')
    expect(saved.rooms[0].measurements).not.toHaveProperty('widthCm')
    expect(saved.rooms[0].measurements).not.toHaveProperty('depthCm')
  })

  it('keeps unsupported and utility rooms in the source reading without creating them', async () => {
    const extendedReading: PlanReading = {
      ...reading,
      rooms: [
        ...reading.rooms,
        { name: 'Ванная', kind: 'bath', sourceNumber: 7, areaM2: 3.89 },
        { name: 'Коридор', kind: 'living', utility: true, sourceNumber: 5, areaM2: 7.7 },
      ],
    }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: extendedReading })
    const data = input()
    const first = data.rooms[0]
    if (!first) throw new Error('Fixture has no rooms')
    data.rooms.push({ ...first, include: false, name: 'Ванная', kind: 'living', sourceNumber: 7 })
    data.rooms.push({ ...first, include: false, name: 'Коридор', kind: 'living', sourceNumber: 5 })
    expect(
      (await confirmPlanRooms(projectId, data, planEditRevision('plan.pdf', extendedReading))).ok,
    ).toBe(true)
    const saved = mocks.createRooms.mock.calls[0]?.[2]
    expect(saved.reading.rooms[2]).toMatchObject({ name: 'Ванная', kind: 'bath', sourceNumber: 7 })
    expect(saved.reading.rooms[3]).toMatchObject({ name: 'Коридор', utility: true })
    expect(saved.rooms).toHaveLength(2)
  })

  it('rejects stale or missing confirmation revisions without creating rooms', async () => {
    expect(await confirmPlanRooms(projectId, input(), 'old-revision')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(await confirmPlanRooms(projectId, input())).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.createRooms).not.toHaveBeenCalled()
  })

  it('rejects a stale read before calling the paid reader', async () => {
    expect(await readPlan(projectId, 6, 'old-revision')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('returns the revision of the saved reading for the next form action', async () => {
    const result = await readPlan(projectId, 6, planEditRevision('plan.pdf', reading))
    if (!result.ok) throw new Error(result.error)
    expect(result.data.revision).toBe(planEditRevision('plan.pdf', result.data.reading))
  })

  it('does not confirm a source without a file or reading', async () => {
    mocks.owner.mockResolvedValue({ planUrl: null, planReading: null })
    expect((await confirmPlanRooms(projectId, input(), planEditRevision(null, null))).ok).toBe(
      false,
    )
    expect(mocks.createRooms).not.toHaveBeenCalled()
  })

  it('withdraws old geometry confirmation while preserving the drawn coordinates', async () => {
    const geometry = {
      version: 1 as const,
      source: 'manual' as const,
      status: 'confirmed' as const,
      confirmedAt: '2026-09-26',
      widthCm: 500,
      heightCm: 400,
      rooms: [],
      walls: [],
      openings: [],
      warnings: [],
    }
    const source = { planUrl: 'plan.pdf', planReading: { ...reading, geometry } }
    mocks.owner.mockResolvedValue(source)
    const result = await confirmPlanRooms(
      projectId,
      input(),
      planEditRevision(source.planUrl, source.planReading),
    )
    if (!result.ok) throw new Error(result.error)
    const saved = mocks.createRooms.mock.calls[0]?.[2].reading
    expect(saved.geometry).toEqual({ ...geometry, status: 'draft', confirmedAt: undefined })
    expect(saved.geometry).not.toHaveProperty('confirmedAt')
    expect(geometry.status).toBe('confirmed')
    expect(mocks.createRooms.mock.calls[0]?.[3]).toEqual(source)
    expect(result.data.revision).toBe(planEditRevision(source.planUrl, saved))
  })

  it('rejects replay of the same room form after the first confirmation', async () => {
    const revision = planEditRevision('plan.pdf', reading)
    mocks.createRooms.mockImplementationOnce(async (_user, _id, input) => {
      mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: input.reading })
      return { created: 2, updated: 0 }
    })
    expect((await confirmPlanRooms(projectId, input(), revision)).ok).toBe(true)
    expect(await confirmPlanRooms(projectId, input(), revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.createRooms).toHaveBeenCalledTimes(1)
  })

  it('reports a conflict between room validation and transactional write', async () => {
    mocks.createRooms.mockRejectedValueOnce(new PlanEditConflictError())
    expect(
      await confirmPlanRooms(projectId, input(), planEditRevision('plan.pdf', reading)),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
  })

  const pageReview: NonNullable<PlanReading['pageReview']> = {
    version: 1,
    savedAt: '2026-09-27',
    contours: {
      source: { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' },
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: 842,
      pageHeight: 1191,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
          ],
        },
      ],
    },
  }

  it('requires a saved review before the explicitly requested reviewed read', async () => {
    expect((await readPlan(projectId, 6, planEditRevision('plan.pdf', reading), true)).ok).toBe(
      false,
    )
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('passes only saved contours to the reviewed reader and preserves the review on the same page', async () => {
    const before = { ...reading, pageReview }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    const result = await readPlan(projectId, 6, planEditRevision('plan.pdf', before), true)
    if (!result.ok) throw new Error(result.error)
    expect(mocks.read).toHaveBeenCalledWith('plan.pdf', 6, pageReview.contours)
    expect(result.data.reading.pageReview).toEqual(pageReview)
  })

  it('keeps saved contours after room confirmation without asserting measurement verification', async () => {
    const before = { ...reading, pageReview }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    expect(
      (await confirmPlanRooms(projectId, input(), planEditRevision('plan.pdf', before))).ok,
    ).toBe(true)
    expect(mocks.createRooms.mock.calls[0]?.[2].reading.pageReview).toEqual(pageReview)
    expect(mocks.createRooms.mock.calls[0]?.[2].rooms[0].measurements).not.toHaveProperty(
      'verification',
    )
  })

  it('drops the review when ordinary reading switches to a different sheet', async () => {
    const before = { ...reading, pageReview }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    mocks.read.mockResolvedValue({ ...reading, sourcePage: 12, planState: 'proposed' })
    const result = await readPlan(projectId, 12, planEditRevision('plan.pdf', before))
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading).not.toHaveProperty('pageReview')
  })

  it('rejects another sheet before a paid reviewed read starts', async () => {
    const before = { ...reading, pageReview }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    expect((await readPlan(projectId, 12, planEditRevision('plan.pdf', before), true)).ok).toBe(
      false,
    )
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
