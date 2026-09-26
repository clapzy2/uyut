import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), object: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@uyut/ai', () => ({ createFalPlanReader: () => mocks.read }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ FAL_KEY: 'test-key' }) }))
vi.mock('@/lib/storage', () => ({ getObject: mocks.object }))
vi.mock('./plan-document', () => ({
  PlanReadError: class PlanReadError extends Error {},
  preparePlanPage: mocks.prepare,
}))

import { readPlanFromStorage } from './plan-reading'

describe('single-page plan reader budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue({
      image: { body: Buffer.from('page6'), contentType: 'image/jpeg' },
      pageNumber: 6,
      pageCount: 48,
    })
    mocks.read.mockResolvedValue({
      planState: 'existing',
      rooms: [{ name: 'Кухня', widthCm: 296.4, depthCm: 420.5, areaM2: 12.35 }],
    })
  })

  it('uses one paid call without automatic side rechecks', async () => {
    const reading = await readPlanFromStorage('plan.PDF', 6)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6)
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(reading).toMatchObject({ sourcePage: 6, pageCount: 48, planState: 'existing' })
    expect(reading.rooms[0]).toMatchObject({ widthCm: 296.4, depthCm: 420.5 })
  })

  it('makes no paid call if the selected page is invalid', async () => {
    mocks.prepare.mockRejectedValue(new Error('invalid page'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(readPlanFromStorage('plan.pdf', 49)).rejects.toThrow('Не получилось')
    expect(mocks.read).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('retains unknown sides for an area-only room', async () => {
    mocks.read.mockResolvedValue({ rooms: [{ name: 'Коридор', areaM2: 7.7 }] })
    const reading = await readPlanFromStorage('plan.pdf', 6)
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.depthCm).toBeUndefined()
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
})
