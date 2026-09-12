import {
  applyRecheck,
  mergeReadings,
  needsRecheck,
  parseFloorPlan,
  parseSideRecheck,
  roomKindFromName,
} from '@uyut/ai'
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

describe('needsRecheck', () => {
  const room = { name: 'Гостиная', kind: 'living' as const }

  it('расхождение площади больше двух процентов зовёт перечитать сторону', () => {
    // 393 на 425 это 16,7 м², а подписано 16,3: одно из чисел прочитано неверно
    expect(needsRecheck({ ...room, widthCm: 393, depthCm: 425, areaM2: 16.3 })).toBe(true)
  })

  it('округление подписи за ошибку не считаем', () => {
    expect(needsRecheck({ ...room, widthCm: 383, depthCm: 425, areaM2: 16.3 })).toBe(false)
  })

  it('без одного из трёх чисел сверять нечего', () => {
    expect(needsRecheck({ ...room, widthCm: 383, areaM2: 16.3 })).toBe(false)
    expect(needsRecheck({ ...room, widthCm: 383, depthCm: 425 })).toBe(false)
  })
})

describe('parseSideRecheck', () => {
  it('складывает отрезки сама и переводит в сантиметры', () => {
    expect(parseSideRecheck('{"segments": [900, 2100, 830], "totalMm": 3830}')).toBe(383)
  })

  it('своей сумме модели не верим', () => {
    // Отрезки верные, сумма у модели чужая: берём отрезки
    expect(parseSideRecheck('{"segments": [900, 2100, 830], "totalMm": 3930}')).toBe(383)
  })

  it('одно число тоже цепочка', () => {
    expect(parseSideRecheck('Вот ответ: {"segments": [2900], "totalMm": 2900}')).toBe(290)
  })

  it('пустой ответ и мусор дают undefined', () => {
    expect(parseSideRecheck('{"segments": [], "totalMm": null}')).toBeUndefined()
    expect(parseSideRecheck('размерной линии не видно')).toBeUndefined()
    expect(parseSideRecheck('{"segments": [900, "не число"]}')).toBeUndefined()
  })

  it('неправдоподобную сумму отбрасываем так же, как в общем чтении', () => {
    expect(parseSideRecheck('{"segments": [90000], "totalMm": 90000}')).toBeUndefined()
  })
})

describe('applyRecheck', () => {
  const living = {
    name: 'Гостиная',
    kind: 'living' as const,
    widthCm: 393,
    depthCm: 425,
    areaM2: 16.3,
    suspicious: true,
  }

  it('берёт перечитанную сторону, когда после неё площадь сходится', () => {
    const fixed = applyRecheck(living, { widthCm: 383, depthCm: 425 })
    expect(fixed?.widthCm).toBe(383)
    expect(fixed?.rechecked).toEqual(['width'])
    // Подозрение снято: числа теперь сходятся между собой
    expect(fixed?.suspicious).toBeUndefined()
  })

  it('не меняет одну ошибку на другую: площадь всё ещё не сходится', () => {
    expect(applyRecheck(living, { widthCm: 500, depthCm: 425 })).toBeNull()
  })

  it('перечёт подтвердил прежние числа — менять нечего', () => {
    expect(applyRecheck({ ...living, widthCm: 383 }, { widthCm: 383, depthCm: 425 })).toBeNull()
  })

  it('одна сторона не перечиталась, вторая исправила', () => {
    const fixed = applyRecheck(living, { depthCm: 415 })
    // 393 на 415 это 16,3 м², и это сходится
    expect(fixed?.rechecked).toEqual(['depth'])
    expect(fixed?.widthCm).toBe(393)
  })

  it('без подписанной площади сверять не с чем', () => {
    expect(applyRecheck({ ...living, areaM2: undefined }, { widthCm: 383 })).toBeNull()
  })
})

describe('mergeReadings', () => {
  const room = (name: string, widthCm: number) => ({
    name,
    kind: 'living' as const,
    widthCm,
  })

  it('собирает комнаты со всех страниц файла', () => {
    const merged = mergeReadings([
      { ceilingCm: 270, rooms: [room('Гостиная', 383)] },
      { rooms: [room('Спальня', 290)] },
    ])
    expect(merged.rooms.map((r) => r.name)).toEqual(['Гостиная', 'Спальня'])
    expect(merged.ceilingCm).toBe(270)
  })

  it('одноимённую комнату со второй страницы не берём: первая ближе к плану', () => {
    const merged = mergeReadings([
      { rooms: [room('Гостиная', 383)] },
      { rooms: [room('гостиная ', 999)] },
    ])
    expect(merged.rooms).toHaveLength(1)
    expect(merged.rooms[0]?.widthCm).toBe(383)
  })

  it('высоту потолка берём с первой страницы, где она нашлась', () => {
    const merged = mergeReadings([{ rooms: [] }, { ceilingCm: 265, rooms: [room('Кухня', 245)] }])
    expect(merged.ceilingCm).toBe(265)
  })
})

describe('стойкость разбора к мусору модели', () => {
  it('вложенные объекты и числа строками не ломают чтение', () => {
    const raw =
      'Вот результат: {"ceilingMm":"2700","rooms":[{"name":"Кухня","widthMm":"2450","depthMm":2800,"areaM2":"6.9"}]} Конец.'
    const reading = parseFloorPlan(raw)
    expect(reading.ceilingCm).toBe(270)
    expect(reading.rooms[0]).toMatchObject({ widthCm: 245, depthCm: 280, areaM2: 6.9 })
  })

  it('комнат больше двадцати — берём все, лишнее отсечёт форма', () => {
    const rooms = Array.from({ length: 25 }, (_, index) => ({
      name: `Комната ${index + 1}`,
      widthMm: 3000,
    }))
    expect(parseFloorPlan(JSON.stringify({ rooms })).rooms).toHaveLength(25)
  })

  it('строка вместо объекта комнаты пропускается', () => {
    const raw = '{"rooms":["Кухня",{"name":"Спальня","widthMm":2900}]}'
    expect(parseFloorPlan(raw).rooms.map((room) => room.name)).toEqual(['Спальня'])
  })
})

describe('одинаковые названия комнат', () => {
  it('три «Комнаты» в плане БТИ остаются тремя комнатами', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        ceilingMm: 2700,
        rooms: [
          { name: 'Комната', widthMm: 3000, depthMm: 4000 },
          { name: 'Комната', widthMm: 2800, depthMm: 3600 },
          { name: 'Комната', widthMm: 2500, depthMm: 3200 },
        ],
      }),
    )
    expect(reading.rooms.map((room) => room.name)).toEqual(['Комната', 'Комната 2', 'Комната 3'])
    expect(reading.rooms.map((room) => room.widthCm)).toEqual([300, 280, 250])
  })

  it('пустая строка вместо комнаты ответ не роняет', () => {
    const raw = '{"ceilingMm":2700,"rooms":[{"name":"Кухня","widthMm":2450},null]}'
    expect(parseFloorPlan(raw).rooms).toHaveLength(1)
  })

  it('повтор со второй страницы отсеивается, повтор внутри страницы — нет', () => {
    const merged = mergeReadings([
      {
        rooms: [
          { name: 'Комната', kind: 'living', widthCm: 300 },
          { name: 'Комната 2', kind: 'living', widthCm: 280 },
        ],
      },
      { rooms: [{ name: 'Комната', kind: 'living', widthCm: 999 }] },
    ])
    expect(merged.rooms.map((room) => room.widthCm)).toEqual([300, 280])
  })
})
