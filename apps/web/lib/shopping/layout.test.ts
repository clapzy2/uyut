import { describe, expect, it, vi } from 'vitest'
import { projectLayoutGaps } from './layout'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({ getShoppingList: vi.fn() }))

const rooms = [
  { id: 'living', name: 'Гостиная' },
  { id: 'bedroom', name: 'Спальня' },
  { id: 'kitchen', name: 'Кухня' },
]

describe('покупки комнат без доступной расстановки', () => {
  it('называет только пропущенную комнату и считает все копии, сохраняя исходные данные', () => {
    const list = {
      items: [
        { roomId: 'living', quantity: 1 },
        { roomId: 'bedroom', quantity: 2 },
        { roomId: 'bedroom', quantity: 3 },
      ],
    }
    const layouts = [{ roomId: 'living' }]
    const before = structuredClone({ rooms, list, layouts })
    expect(projectLayoutGaps(rooms, list, layouts)).toEqual([
      { roomId: 'bedroom', roomName: 'Спальня', itemCount: 5 },
    ])
    expect({ rooms, list, layouts }).toEqual(before)
  })

  it('не приписывает товары без комнаты другой комнате и не объявляет пробел без покупок', () => {
    expect(projectLayoutGaps(rooms, { items: [{ roomId: null, quantity: 4 }] }, [])).toEqual([])
    expect(projectLayoutGaps(rooms, { items: [] }, [])).toEqual([])
  })

  it('сохраняет порядок комнат, а не порядок строк покупок', () => {
    expect(
      projectLayoutGaps(
        rooms,
        {
          items: [
            { roomId: 'kitchen', quantity: 3 },
            { roomId: 'living', quantity: 1 },
          ],
        },
        [],
      ),
    ).toEqual([
      { roomId: 'living', roomName: 'Гостиная', itemCount: 1 },
      { roomId: 'kitchen', roomName: 'Кухня', itemCount: 3 },
    ])
  })

  it('убирает подсказку после появления расстановки без изменения списка покупок', () => {
    const list = { items: [{ roomId: 'bedroom', quantity: 2 }] }
    expect(projectLayoutGaps(rooms, list, [])).toHaveLength(1)
    expect(projectLayoutGaps(rooms, list, [{ roomId: 'bedroom' }])).toEqual([])
    expect(list.items).toEqual([{ roomId: 'bedroom', quantity: 2 }])
  })
})
