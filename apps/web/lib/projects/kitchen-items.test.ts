import { describe, expect, it } from 'vitest'
import { kitchenItemIssues, kitchenItemsSchema } from './kitchen-items'

const item = { id: 'one', kind: 'sink' as const, xCm: 0, yCm: 0, widthCm: 60, depthCm: 60 }
describe('кухонные модули', () => {
  it('принимает соседние секции без пересечения', () => {
    expect(kitchenItemIssues([item, { ...item, id: 'two', xCm: 60 }], 300, 300)).toEqual([])
  })
  it('обнаруживает наложение и выход за полотно', () => {
    expect(kitchenItemIssues([item, { ...item, id: 'two', xCm: 50 }], 100, 300)).toHaveLength(2)
  })
  it('отвергает нечисловые размеры и повторные ID на сервере', () => {
    expect(kitchenItemsSchema.safeParse([{ ...item, widthCm: Number.NaN }]).success).toBe(false)
    expect(kitchenItemsSchema.safeParse([item, item]).success).toBe(false)
    expect(kitchenItemsSchema.parse([item])).toEqual([item])
  })
})
