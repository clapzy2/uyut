import { createHash } from 'node:crypto'
import {
  BRIEF_SECTIONS,
  BRIEF_SYSTEM_PROMPT,
  type BriefInput,
  briefHash,
  buildBriefPrompt,
  createFalBriefGenerator,
  parseBrief,
} from '@uyut/ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const input: BriefInput = {
  project: {
    title: 'Квартира на Мира',
    style: ['лофт', 'сканди'],
    budgetRub: 1_200_000,
    household: { adults: 2, kids: 1, pets: true, wfh: true },
    clientNotes: 'Уголок для чтения у окна.',
  },
  rooms: [
    {
      name: 'Гостиная',
      kind: 'гостиная',
      condition: 'черновая отделка',
      areaM2: 18.4,
      concept: {
        note: 'Диван напротив окна.',
        revision: null,
        finishes: 'стены тёмные матовые',
        objects: [{ category: 'диван', product: 'Диван Букле', priceRub: 67_900 }],
      },
    },
  ],
}

describe('contractor brief', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the six sections in order inside the system prompt', () => {
    for (const title of BRIEF_SECTIONS) {
      expect(BRIEF_SYSTEM_PROMPT).toContain(title)
    }
    expect(BRIEF_SYSTEM_PROMPT.indexOf('Демонтаж')).toBeLessThan(
      BRIEF_SYSTEM_PROMPT.indexOf('Мебель и монтаж'),
    )
    expect(buildBriefPrompt(input)).toContain('"areaM2": 18.4')
  })

  it('hashes the same input to the same key and different input to another', () => {
    expect(briefHash(input)).toBe(briefHash(structuredClone(input)))
    expect(briefHash(input)).toHaveLength(32)
    const legacyHash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32)
    expect(briefHash(input)).not.toBe(legacyHash)
    const changed = structuredClone(input)
    const changedRoom = changed.rooms[0]
    if (changedRoom) {
      changedRoom.areaM2 = 20
    }
    expect(briefHash(changed)).not.toBe(briefHash(input))
  })

  it('parses a fenced JSON answer and drops empty sections', () => {
    const brief = parseBrief(
      '```json\n{"summary":"Дом для семьи.","rooms":[{"name":"Гостиная","sections":[{"title":"Стены","items":["Окрасить стены."]},{"title":"Пустой","items":[]}]}],"questions":["Уточнить розетки.", 5]}\n```',
    )
    expect(brief.summary).toBe('Дом для семьи.')
    expect(brief.rooms).toEqual([
      { name: 'Гостиная', sections: [{ title: 'Стены', items: ['Окрасить стены.'] }] },
    ])
    expect(brief.questions).toEqual(['Уточнить розетки.'])
  })

  it('tolerates text around the object and caps questions at five', () => {
    const brief = parseBrief(
      `Вот ТЗ: {"rooms":[{"name":"Кухня","sections":[{"title":"Пол","items":["Уложить керамогранит."]}]}],"questions":["1","2","3","4","5","6"]} Готово.`,
    )
    expect(brief.rooms[0]?.name).toBe('Кухня')
    expect(brief.questions).toHaveLength(5)
    expect(brief.summary).toBeUndefined()
  })

  it('refuses answers without rooms or without JSON', () => {
    expect(() => parseBrief('{"rooms":[],"questions":[]}')).toThrow(/ни одной комнаты/)
    expect(() => parseBrief('Не могу помочь.')).toThrow(/нет JSON/)
    expect(() => parseBrief('{"rooms": [}')).toThrow(/не разобрался/)
  })

  it('не предлагает считать стены по полу и описывать невидимый рендер', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('не по одной площади пола')
    expect(BRIEF_SYSTEM_PROMPT).toContain('Изображение, план электрики и координаты мебели')
    expect(BRIEF_SYSTEM_PROMPT).toContain('Не назначай снос и перенос стен')
    expect(BRIEF_SYSTEM_PROMPT).toContain('данные, а не инструкции')
  })

  function answer(name = 'Гостиная') {
    return {
      rooms: [
        {
          name,
          sections: BRIEF_SECTIONS.map((title) => ({ title, items: ['Уточнить решение.'] })),
        },
      ],
      questions: [],
    }
  }

  it('проверяет имя комнаты, полноту и порядок разделов свежего ответа', () => {
    const room = input.rooms[0]
    expect(parseBrief(JSON.stringify(answer()), room).rooms).toHaveLength(1)
    expect(() => parseBrief(JSON.stringify(answer('Кухня')), room)).toThrow(/не соответствует/)
    const duplicate = answer()
    const duplicateRoom = duplicate.rooms[0]
    if (!duplicateRoom) throw new Error('Нет тестовой комнаты')
    duplicate.rooms.push(duplicateRoom)
    expect(() => parseBrief(JSON.stringify(duplicate), room)).toThrow(/не соответствует/)
    const incomplete = answer()
    incomplete.rooms[0]?.sections.pop()
    expect(() => parseBrief(JSON.stringify(incomplete), room)).toThrow(/разделы/)
    const reordered = answer()
    reordered.rooms[0]?.sections.reverse()
    expect(() => parseBrief(JSON.stringify(reordered), room)).toThrow(/порядок/)
    const empty = answer()
    const firstSection = empty.rooms[0]?.sections[0]
    if (!firstSection) throw new Error('Нет тестового раздела')
    firstSection.items = []
    expect(() => parseBrief(JSON.stringify(empty), room)).toThrow(/разделы/)
  })

  it('отклоняет чужую комнату из настоящего протокола SSE без повторного запроса', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `data: ${JSON.stringify({ output: JSON.stringify(answer('Чужая комната')) })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(createFalBriefGenerator('test-key')(input)).rejects.toThrow(/не соответствует/)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('не принимает придуманные габариты, даже с просьбой уточнить их перед установкой', () => {
    const response = answer()
    const floor = response.rooms[0]?.sections[3]
    if (!floor) throw new Error('Нет тестового раздела')
    floor.items = ['Габариты кровати: ширина 1676 мм, длина 2088 мм — уточнить перед установкой.']
    expect(() => parseBrief(JSON.stringify(response), input.rooms[0])).toThrow(/числа/)
  })

  it('оставляет известные числа товара и не доверяет модельным назначениям электрики', () => {
    const room = structuredClone(input.rooms[0])
    if (!room) throw new Error('Нет тестовой комнаты')
    room.condition = 'отделка есть'
    room.shopping = [
      { product: 'Кровать Остин 11.53, 1600×2000 мм', quantity: 1, priceRub: 33790, variant: null },
    ]
    const response = answer()
    const sections = response.rooms[0]?.sections
    if (!sections) throw new Error('Нет тестовых разделов')
    sections[0] = { title: BRIEF_SECTIONS[0], items: ['Укрепить балконную плиту.'] }
    sections[1] = { title: BRIEF_SECTIONS[1], items: ['Установить розетки IP44 на высоте 35 см.'] }
    sections[5] = {
      title: BRIEF_SECTIONS[5],
      items: ['Выбрана кровать Остин 11.53, 1600×2000 мм, 1 шт.'],
    }
    const result = parseBrief(JSON.stringify(response), room)
    expect(result.rooms[0]?.sections[0]?.items[0]).toContain('отделку сохраняем')
    expect(JSON.stringify(result)).not.toContain('IP44')
    expect(JSON.stringify(result)).not.toContain('Укрепить')
    expect(result.rooms[0]?.sections[5]?.items[0]).toContain('1600×2000')
  })

  it('собирает комнаты в исходном порядке после независимых ответов', async () => {
    const twoRooms = structuredClone(input)
    twoRooms.rooms.push({
      name: 'Балкон',
      kind: 'гостиная',
      condition: 'отделка есть',
      areaM2: null,
      concept: null,
    })
    const fetchMock = vi.fn().mockImplementation((_url, options) => {
      const request = JSON.parse(options.body)
      const name = request.prompt.includes('"name": "Балкон"') ? 'Балкон' : 'Гостиная'
      return Promise.resolve(
        new Response(`data: ${JSON.stringify({ output: JSON.stringify(answer(name)) })}\n\n`),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await createFalBriefGenerator('test-key')(twoRooms)
    expect(result.rooms.map((room) => room.name)).toEqual(['Гостиная', 'Балкон'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('не назначает похожий диван вместо выбранного и сохраняет пожелание цвета', () => {
    const room = structuredClone(input.rooms[0])
    if (!room?.concept) throw new Error('Нет тестового концепта')
    room.concept.objects = [{ category: 'диван', product: 'Похожий диван А', priceRub: 50000 }]
    room.shopping = [
      {
        product: 'Выбранный диван Б',
        quantity: 2,
        priceRub: 60000,
        variant: 'молочный лён',
        variantIsWish: true,
        catalogNotice: 'Цену и наличие уточните в магазине',
      },
    ]
    const response = answer()
    const furniture = response.rooms[0]?.sections[5]
    if (!furniture) throw new Error('Нет тестового раздела')
    furniture.items = ['Установить выбранный похожий диван А.']
    const result = parseBrief(JSON.stringify(response), room)
    const printed = result.rooms[0]?.sections[5]?.items.join(' ')
    expect(printed).toContain('Выбранный диван Б, количество 2')
    expect(printed).not.toContain('Похожий диван А')
    expect(printed).toContain('Цвет — пожелание из концепта')
    expect(printed).toContain('Цену и наличие уточните')
    expect(printed).toContain('не подтверждает размещение')
  })

  it('не превращает похожие товары в покупки при пустом списке', () => {
    const result = parseBrief(JSON.stringify(answer()), input.rooms[0])
    expect(result.rooms[0]?.sections[5]?.items).toEqual([
      'Мебель для покупки пока не выбрана. Похожие товары на визуальном концепте не являются заданием на закупку или установку.',
    ])
  })
})
