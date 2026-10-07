import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  size: vi.fn(),
  clearance: vi.fn(),
  placement: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/projects/repository', () => ({ updateRoom: vi.fn() }))
vi.mock('@/lib/shopping/repository', () => ({
  addShoppingItem: vi.fn(),
  getShoppingList: vi.fn(),
  removeShoppingItem: vi.fn(),
  setShoppingItemQuantity: vi.fn(),
  setShoppingItemSize: mocks.size,
  setShoppingItemOperationClearance: mocks.clearance,
  setShoppingItemPlacement: mocks.placement,
}))

import { resetItemSize, setItemOperationClearance, setItemPlacement, setItemSize } from './shopping'

describe('точные мерки в действиях списка покупок', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    for (const save of [mocks.size, mocks.clearance, mocks.placement]) {
      save.mockResolvedValue({ projectId: 'project' })
    }
  })

  it('сохраняет дробные габариты с запятой и точкой без округления', async () => {
    expect(await setItemSize('item', { width: '105,6', depth: ' 70.4 ', height: '85,2' })).toEqual({
      ok: true,
      data: undefined,
    })
    expect(mocks.size).toHaveBeenCalledWith('owner', 'item', {
      width: 105.6,
      depth: 70.4,
      height: 85.2,
    })
    expect(mocks.revalidate).toHaveBeenCalledWith('/projects/project/summary')
  })

  it('очищает неизвестную высоту, не меняя известные стороны', async () => {
    await setItemSize('item', { width: '105,6', depth: '70,4', height: '' })
    expect(mocks.size).toHaveBeenCalledWith('owner', 'item', { width: 105.6, depth: 70.4 })
  })

  it('сохраняет дробные рабочие зоны', async () => {
    await setItemOperationClearance('item', { front: '50,4', side: '10.2', around: '' })
    expect(mocks.clearance).toHaveBeenCalledWith('owner', 'item', { front: 50.4, side: 10.2 })
  })

  it('не округляет точное положение мебели', async () => {
    await setItemPlacement('item', {
      mode: 'exact',
      xCm: '220,4',
      yCm: '200.2',
      rotation: '90',
      frontDirection: 'left',
    })
    expect(mocks.placement).toHaveBeenCalledWith('owner', 'item', {
      xCm: 220.4,
      yCm: 200.2,
      rotation: 90,
      frontDirection: 'left',
    })
  })

  it.each(['', ' ', 'NaN', '-0.1', '10000.1'])(
    'не подставляет координату вместо %s',
    async (xCm) => {
      expect(
        (await setItemPlacement('item', { mode: 'exact', xCm, yCm: '0', rotation: '0' })).ok,
      ).toBe(false)
      expect(mocks.placement).not.toHaveBeenCalled()
    },
  )

  it('оставляет возможность вернуть автоматическую расстановку', async () => {
    expect((await setItemPlacement('item', { mode: 'auto' })).ok).toBe(true)
    expect(mocks.placement).toHaveBeenCalledWith('owner', 'item', null)
  })

  it.each(['4.99', '500.01', 'NaN', 'Infinity', '105,6,7'])(
    'отклоняет размер %s',
    async (width) => {
      expect((await setItemSize('item', { width, depth: '', height: '' })).ok).toBe(false)
      expect(mocks.size).not.toHaveBeenCalled()
    },
  )

  it('не принимает пустую форму за сохранённые размеры', async () => {
    expect((await setItemSize('item', { width: '', depth: '', height: '' })).ok).toBe(false)
    expect(mocks.size).not.toHaveBeenCalled()
  })

  it('сбрасывает собственные габариты только отдельным действием владельца', async () => {
    expect(await resetItemSize('item')).toEqual({ ok: true, data: undefined })
    expect(mocks.size).toHaveBeenCalledWith('owner', 'item', {})
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'item',
        metadata: { projectId: 'project', sizeResetToCatalog: true },
      }),
    )
    expect(mocks.revalidate).toHaveBeenCalledWith('/projects/project/summary')
  })

  it('не сохраняет данные без авторизации', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect((await setItemSize('item', { width: '105,6', depth: '', height: '' })).ok).toBe(false)
    expect(mocks.size).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect((await resetItemSize('item')).ok).toBe(false)
    expect(mocks.size).not.toHaveBeenCalled()
  })
})
