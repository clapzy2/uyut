import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const reading = {
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
    expect((await readPlan(projectId, 6)).ok).toBe(true)
    expect(mocks.read).toHaveBeenCalledWith('plan.pdf', 6)
    expect(mocks.setReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({ sourcePage: 6, pageCount: 48, planState: 'existing' }),
    )
  })

  it('does not read or save a document without an authenticated owner', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await readPlan(projectId, 6)).ok).toBe(false)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.setReading).not.toHaveBeenCalled()
  })

  it('preserves decimal dimensions, individual ceilings and sheet provenance on save', async () => {
    expect((await confirmPlanRooms(projectId, input('270'))).ok).toBe(true)
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
    expect((await confirmPlanRooms(projectId, data)).ok).toBe(true)
    const saved = mocks.createRooms.mock.calls[0]?.[2]
    expect(saved.rooms[0].measurements).not.toHaveProperty('ceilingCm')
    expect(saved.rooms[0].measurements).not.toHaveProperty('widthCm')
    expect(saved.rooms[0].measurements).not.toHaveProperty('depthCm')
  })

  it('keeps unsupported and utility rooms in the source reading without creating them', async () => {
    mocks.owner.mockResolvedValue({
      planUrl: 'plan.pdf',
      planReading: {
        ...reading,
        rooms: [
          ...reading.rooms,
          { name: 'Ванная', kind: 'bath', sourceNumber: 7, areaM2: 3.89 },
          { name: 'Коридор', kind: 'living', utility: true, sourceNumber: 5, areaM2: 7.7 },
        ],
      },
    })
    const data = input()
    const first = data.rooms[0]
    if (!first) throw new Error('Fixture has no rooms')
    data.rooms.push({ ...first, include: false, name: 'Ванная', kind: 'living', sourceNumber: 7 })
    data.rooms.push({ ...first, include: false, name: 'Коридор', kind: 'living', sourceNumber: 5 })
    expect((await confirmPlanRooms(projectId, data)).ok).toBe(true)
    const saved = mocks.createRooms.mock.calls[0]?.[2]
    expect(saved.reading.rooms[2]).toMatchObject({ name: 'Ванная', kind: 'bath', sourceNumber: 7 })
    expect(saved.reading.rooms[3]).toMatchObject({ name: 'Коридор', utility: true })
    expect(saved.rooms).toHaveLength(2)
  })
})
