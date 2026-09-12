import { parseFloorPlan, roomKindFromName } from '@uyut/ai'
import { describe, expect, it } from 'vitest'

function answer(rooms: unknown[], ceilingMm: number | null = 2700): string {
  return JSON.stringify({ ceilingMm, rooms })
}

describe('roomKindFromName', () => {
  it('узнаёт комнаты по названию с плана', () => {
    expect(roomKindFromName('Спальня 2')).toBe('bedroom')
    expect(roomKindFromName('Кухня')).toBe('kitchen')
    expect(roomKindFromName('Санузел совмещённый')).toBe('bath')
    expect(roomKindFromName('Детская')).toBe('kid')
  })

  it('кухня-гостиная это кухня: там мойка и плита, а они решают всё', () => {
    expect(roomKindFromName('Кухня-гостиная')).toBe('kitchen')
  })

  it('прихожая и кабинет своего типа пока не имеют и живут как гостиная', () => {
    expect(roomKindFromName('Прихожая')).toBe('living')
    expect(roomKindFromName('Кабинет')).toBe('living')
    expect(roomKindFromName('Комната')).toBe('living')
  })
})

describe('parseFloorPlan', () => {
  it('переводит миллиметры плана в сантиметры', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Гостиная', widthMm: 3830, depthMm: 4250, areaM2: 16.3 }]),
    )
    expect(reading.ceilingCm).toBe(270)
    expect(reading.rooms[0]).toMatchObject({
      name: 'Гостиная',
      kind: 'living',
      widthCm: 383,
      depthCm: 425,
      areaM2: 16.3,
    })
  })

  it('достаёт JSON из ответа с болтовнёй вокруг', () => {
    const raw = `Вот что видно на плане:\n${answer([{ name: 'Кухня', widthMm: 2450, depthMm: 2800 }])}\nБольше размеров нет.`
    expect(parseFloorPlan(raw).rooms).toHaveLength(1)
  })

  it('молчит, когда ответ не разобрать', () => {
    expect(parseFloorPlan('не вижу размеров').rooms).toEqual([])
    expect(parseFloorPlan('{сломанный json').rooms).toEqual([])
  })

  it('выбрасывает числа, которыми комната быть не может', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Спальня', widthMm: 38_300, depthMm: 400, areaM2: 12 }]),
    )
    // 38 метров и 40 сантиметров — это склеенная размерная цепочка, а не стены
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.depthCm).toBeUndefined()
    expect(reading.rooms[0]?.areaM2).toBe(12)
  })

  it('комнату без единого числа не показываем: вводить всё равно всё руками', () => {
    expect(parseFloorPlan(answer([{ name: 'Лоджия' }])).rooms).toEqual([])
  })

  it('высота потолка вне жилого диапазона это не потолок', () => {
    expect(parseFloorPlan(answer([{ name: 'Кухня', widthMm: 2450 }], 27_000)).ceilingCm).toBe(
      undefined,
    )
    expect(parseFloorPlan(answer([{ name: 'Кухня', widthMm: 2450 }], null)).ceilingCm).toBe(
      undefined,
    )
  })

  it('помечает строку, где площадь не сходится с размерами', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Спальня', widthMm: 2900, depthMm: 4250, areaM2: 25 }]),
    )
    // 2.9 на 4.25 это 12.3 метра, а подписано 25: одно из трёх чисел чужое
    expect(reading.rooms[0]?.suspicious).toBe(true)
  })

  it('на сходящихся числах не придирается', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Спальня', widthMm: 2900, depthMm: 4250, areaM2: 12.3 }]),
    )
    expect(reading.rooms[0]?.suspicious).toBeUndefined()
  })

  it('без одного из трёх чисел сверять нечего и подозрений нет', () => {
    const reading = parseFloorPlan(answer([{ name: 'Спальня', widthMm: 2900, areaM2: 12.3 }]))
    expect(reading.rooms[0]?.suspicious).toBeUndefined()
  })
})
