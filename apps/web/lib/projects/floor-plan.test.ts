import {
  applyRecheck,
  checkTotalArea,
  estimateSides,
  isUtilityRoom,
  markChainMismatch,
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

describe('подсобные помещения', () => {
  it('прихожая и коридор помечаются как необставляемые', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        rooms: [
          { name: 'Прихожая', widthMm: 1200, depthMm: 7000 },
          { name: 'Гостиная', widthMm: 3830, depthMm: 4250 },
          { name: 'Кладовая', widthMm: 900, depthMm: 1200 },
        ],
      }),
    )
    expect(reading.rooms.map((room) => room.utility === true)).toEqual([true, false, true])
  })

  it('кабинет и зал обставляются: это жилые комнаты', () => {
    expect(isUtilityRoom('Кабинет')).toBe(false)
    expect(isUtilityRoom('Зал')).toBe(false)
    expect(isUtilityRoom('Гардеробная')).toBe(true)
  })
})

describe('стороны из площади', () => {
  it('вторую сторону считает из площади и первой', () => {
    const reading = parseFloorPlan(answer([{ name: 'Кухня', depthMm: 1942, areaM2: 5.4 }]))
    const room = reading.rooms[0]
    expect(room?.depthCm).toBe(194)
    expect(room?.widthCm).toBe(278)
    expect(room?.estimated).toEqual(['width'])
  })

  it('обе стороны берёт из площади и формы, когда размерных линий нет', () => {
    const reading = parseFloorPlan(answer([{ name: 'Спальня', areaM2: 12, aspect: 1.2 }]))
    const room = reading.rooms[0]
    expect(room?.widthCm).toBe(379)
    expect(room?.depthCm).toBe(316)
    expect(room?.estimated).toEqual(['width', 'depth'])
  })

  it('без формы и без сторон ничего не выдумывает', () => {
    const reading = parseFloorPlan(answer([{ name: 'Спальня', areaM2: 12 }]))
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.estimated).toBeUndefined()
  })

  it('прочитанные стороны не трогает', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Гостиная', widthMm: 3830, depthMm: 4250, areaM2: 16.3, aspect: 0.9 }]),
    )
    expect(reading.rooms[0]?.widthCm).toBe(383)
    expect(reading.rooms[0]?.estimated).toBeUndefined()
  })

  it('нелепую форму отвергает и сторон по ней не считает', () => {
    const reading = parseFloorPlan(answer([{ name: 'Спальня', areaM2: 12, aspect: 40 }]))
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
  })
})

describe('estimateSides', () => {
  const living = {
    name: 'Гостиная',
    kind: 'living' as const,
    widthCm: 304,
    depthCm: 412,
    areaM2: 14.9,
    aspect: 0.655,
  }

  it('пересчитывает стороны из площади, когда цепочке верить нечего', () => {
    const fixed = estimateSides(living)
    expect(fixed?.widthCm).toBe(312)
    expect(fixed?.depthCm).toBe(477)
    expect(fixed?.estimated).toEqual(['width', 'depth'])
  })

  it('без своей формы берёт форму из прочитанных сторон', () => {
    const fixed = estimateSides({ ...living, aspect: undefined })
    expect(fixed?.widthCm).toBe(332)
    expect(fixed?.depthCm).toBe(449)
  })

  it('молчит, когда площадь и так сходится', () => {
    expect(estimateSides({ ...living, depthCm: 490 })).toBeNull()
  })

  it('молчит без площади: считать не из чего', () => {
    expect(estimateSides({ ...living, areaM2: undefined })).toBeNull()
  })
})

describe('markChainMismatch', () => {
  const room = {
    name: 'Комната',
    kind: 'living' as const,
    widthCm: 280,
    depthCm: 400,
  }

  it('не подменяет размер без подписанной площади, но требует ручной проверки', () => {
    const flagged = markChainMismatch(room, { widthCm: 330, depthCm: 400 })
    expect(flagged).toMatchObject({ widthCm: 280, depthCm: 400, suspicious: true })
    expect(flagged?.chainMismatch).toEqual(['width'])
  })

  it('не создаёт ложное предупреждение, когда повторная цепочка совпала', () => {
    expect(markChainMismatch(room, { widthCm: 280, depthCm: 400 })).toBeNull()
  })

  it('не вмешивается, когда есть площадь для арифметической проверки', () => {
    expect(markChainMismatch({ ...room, areaM2: 11.2 }, { widthCm: 330 })).toBeNull()
  })
})

describe('checkTotalArea', () => {
  const rooms = [
    { name: 'Прихожая', kind: 'living' as const, areaM2: 5.8 },
    { name: 'Санузел', kind: 'bath' as const, areaM2: 2.7 },
    { name: 'Кухня', kind: 'kitchen' as const, areaM2: 5.4 },
    { name: 'Гостиная', kind: 'living' as const, areaM2: 14.9 },
  ]

  it('сходится, когда сумма равна общей площади', () => {
    const check = checkTotalArea({ totalAreaM2: 28.8, rooms })
    expect(check).toEqual({ sumM2: 28.8, totalM2: 28.8, agrees: true })
  })

  it('ловит выдуманную комнату', () => {
    const check = checkTotalArea({
      totalAreaM2: 28.8,
      rooms: [...rooms, { name: 'Туалет', kind: 'bath' as const, areaM2: 2.8 }],
    })
    expect(check?.agrees).toBe(false)
  })

  it('ловит потерянную комнату', () => {
    expect(checkTotalArea({ totalAreaM2: 28.8, rooms: rooms.slice(1) })?.agrees).toBe(false)
  })

  it('молчит, когда у комнаты нет площади: неполная сумма всегда меньше', () => {
    expect(
      checkTotalArea({
        totalAreaM2: 28.8,
        rooms: [...rooms, { name: 'Кладовая', kind: 'living' as const, widthCm: 100 }],
      }),
    ).toBeUndefined()
  })

  it('молчит без общей площади', () => {
    expect(checkTotalArea({ rooms })).toBeUndefined()
  })
})

describe('прочитанная сторона против формы комнаты', () => {
  it('не делит на отрезок цепочки, принятый за всю сторону', () => {
    // Боевой случай: гостиная 14,9 м², прочитана глубина 252 (один отрезок из трёх),
    // деление давало ширину 591 см — почти вся ширина квартиры
    const reading = parseFloorPlan(
      answer([{ name: 'Гостиная', depthMm: 2520, areaM2: 14.9, aspect: 0.7 }]),
    )
    const room = reading.rooms[0]
    expect(room?.widthCm).toBe(323)
    expect(room?.depthCm).toBe(461)
    expect(room?.estimated).toEqual(['width', 'depth'])
  })

  it('прочитанной стороне, которая сходится с формой, верит и делит на неё', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Кухня', depthMm: 1942, areaM2: 5.4, aspect: 1.2 }]),
    )
    const room = reading.rooms[0]
    expect(room?.depthCm).toBe(194)
    expect(room?.widthCm).toBe(278)
    expect(room?.estimated).toEqual(['width'])
  })

  it('без формы сверять не с чем, и деление остаётся как было', () => {
    const reading = parseFloorPlan(answer([{ name: 'Гостиная', depthMm: 2520, areaM2: 14.9 }]))
    expect(reading.rooms[0]?.widthCm).toBe(591)
  })

  it('ловит прихожую, растянутую делением в полосу', () => {
    const reading = parseFloorPlan(
      answer([{ name: 'Прихожая', widthMm: 6080, areaM2: 5.8, aspect: 2 }]),
    )
    const room = reading.rooms[0]
    expect(room?.widthCm).toBe(341)
    expect(room?.depthCm).toBe(170)
  })
})
