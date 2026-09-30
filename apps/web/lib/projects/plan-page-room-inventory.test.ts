import { describe, expect, it } from 'vitest'
import { planPageRoomInventory } from './plan-page-room-inventory'

const item = (text: string, y: number, x = 630) => ({ text, x, y, rotation: 0 })

describe('экспликация помещений из PDF', () => {
  it('читает только последовательные подписанные строки одного листа', () => {
    const text = JSON.stringify([
      item('Обмерный план', 62, 870),
      item('Экспликация помещений:', 642),
      item('01-Прихожая - 9,99 м', 660),
      item('02-Санузел - 5,17м', 679),
      item('03-Спальня - 25,51м', 697),
      item('2', 692, 802),
      item('04-Кухня - 8,51м', 715),
    ])
    expect(planPageRoomInventory(text)).toEqual([
      { sourceNumber: 1, name: 'Прихожая' },
      { sourceNumber: 2, name: 'Санузел' },
      { sourceNumber: 3, name: 'Спальня' },
      { sourceNumber: 4, name: 'Кухня' },
    ])
  })

  it.each([
    ['нет заголовка', ['01-Кухня - 8,51м', '02-Спальня - 25,51м', '03-Санузел - 5,17м']],
    ['пропущен номер', ['01-Кухня - 8,51м', '03-Спальня - 25,51м', '04-Санузел - 5,17м']],
    ['повторяется номер', ['01-Кухня - 8,51м', '02-Спальня - 25,51м', '02-Санузел - 5,17м']],
  ])('не достраивает список, если %s', (reason, rows) => {
    const heading = reason === 'нет заголовка' ? [] : [item('Экспликация помещений:', 642)]
    expect(
      planPageRoomInventory(
        JSON.stringify([...heading, ...rows.map((row, index) => item(row, 660 + index * 19))]),
      ),
    ).toBeUndefined()
  })

  it('не принимает размерные подписи и надписи другого столбца за комнаты', () => {
    const text = JSON.stringify([
      item('Экспликация помещений:', 642),
      item('01-Кухня - 8,51м', 660),
      item('02-Спальня - 25,51м', 679),
      item('03-Санузел - 5,17м', 697),
      item('04-Надпись - 4,20м', 715, 870),
      item('05-Подпись - 5,20м', 1080),
    ])
    expect(planPageRoomInventory(text)).toHaveLength(3)
  })

  it('не называет список полным, если одна строка экспликации прочитана без площади', () => {
    const text = JSON.stringify([
      item('Экспликация помещений:', 642),
      item('01-Кухня - 8,51м', 660),
      item('02-Спальня - 25,51м', 679),
      item('03-Санузел - 5,17м', 697),
      item('04-Коридор - ???', 715),
    ])
    expect(planPageRoomInventory(text)).toBeUndefined()
  })

  it('видит продолжение экспликации ниже первого блока строк', () => {
    const text = JSON.stringify([
      item('Экспликация помещений:', 100),
      item('01-Кухня - 8,51м', 120),
      item('02-Спальня - 25,51м', 139),
      item('03-Санузел - 5,17м', 158),
      item('04-Коридор - 4,20м', 600),
    ])
    expect(planPageRoomInventory(text)).toHaveLength(4)
  })
})
