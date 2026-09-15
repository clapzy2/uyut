import { toast, useToastStore } from '@uyut/ui'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  for (const item of useToastStore.getState().items) useToastStore.getState().dismiss(item.id)
})

describe('уведомления', () => {
  it('не складывает одинаковые сообщения друг на друга', () => {
    toast({ title: 'Сохранили', tone: 'success' })
    const latestId = toast({ title: 'Сохранили', tone: 'success' })

    expect(useToastStore.getState().items).toEqual([
      { id: latestId, title: 'Сохранили', tone: 'success' },
    ])
  })

  it('оставляет разные сообщения видимыми одновременно', () => {
    toast({ title: 'Сохранили', tone: 'success' })
    toast({ title: 'План прочитан', tone: 'success' })

    expect(useToastStore.getState().items).toHaveLength(2)
  })
})
