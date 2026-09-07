import {
  BRIEF_SECTIONS,
  BRIEF_SYSTEM_PROMPT,
  type BriefInput,
  briefHash,
  buildBriefPrompt,
  parseBrief,
} from '@uyut/ai'
import { describe, expect, it } from 'vitest'

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
    const changed = structuredClone(input)
    changed.rooms[0].areaM2 = 20
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
})
