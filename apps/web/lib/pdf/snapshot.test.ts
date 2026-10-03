import { describe, expect, it, vi } from 'vitest'

const { transaction, select } = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn() }))
vi.mock('../../../../jobs/src/lib/db', () => ({ db: () => ({ transaction }) }))

import { loadSnapshot } from '../../../../jobs/src/lib/pdf-data'

describe('PDF snapshot isolation contract', () => {
  it('runs reads in a read-only repeatable snapshot, including a missing project', async () => {
    const limit = vi.fn().mockResolvedValue([])
    const query = { from: vi.fn(), where: vi.fn(), limit }
    query.from.mockReturnValue(query)
    query.where.mockReturnValue(query)
    select.mockReturnValue(query)
    transaction.mockImplementation((callback) => callback({ select }))
    expect(await loadSnapshot('missing-project')).toBeNull()
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(select).toHaveBeenCalledOnce()
  })
})
