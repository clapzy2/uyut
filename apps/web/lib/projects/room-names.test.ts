import { describe, expect, it } from 'vitest'
import { autoRoomNames, isAutoRoomName } from './room-names'

describe('isAutoRoomName', () => {
  it('подставленным считает пустое, название типа и его с номером', () => {
    expect(isAutoRoomName('')).toBe(true)
    expect(isAutoRoomName('Спальня')).toBe(true)
    expect(isAutoRoomName('Спальня 2')).toBe(true)
  })

  it('своё название остаётся своим', () => {
    expect(isAutoRoomName('Кабинет')).toBe(false)
    expect(isAutoRoomName('Спальня у окна')).toBe(false)
  })
})

describe('autoRoomNames', () => {
  it('вторая спальня получает номер, а первая остаётся без него', () => {
    const rooms = autoRoomNames([
      { kind: 'bedroom', name: 'Спальня' },
      { kind: 'bedroom', name: '' },
      { kind: 'kitchen', name: '' },
    ] as const)
    expect(rooms.map((room) => room.name)).toEqual(['Спальня', 'Спальня 2', 'Кухня'])
  })

  it('название, набранное руками, не трогает и в счёт не идёт', () => {
    const rooms = autoRoomNames([
      { kind: 'bedroom', name: 'Кабинет' },
      { kind: 'bedroom', name: 'Спальня 2' },
    ] as const)
    expect(rooms.map((room) => room.name)).toEqual(['Кабинет', 'Спальня'])
  })

  it('после удаления первой спальни нумерация схлопывается', () => {
    const rooms = autoRoomNames([{ kind: 'bedroom', name: 'Спальня 2' }] as const)
    expect(rooms[0]?.name).toBe('Спальня')
  })

  it('неизменившиеся комнаты возвращаются теми же объектами', () => {
    const kitchen = { kind: 'kitchen', name: 'Кухня' } as const
    expect(autoRoomNames([kitchen])[0]).toBe(kitchen)
  })
})
