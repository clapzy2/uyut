import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { kitchenItemIssues, kitchenItemsSchema } from './kitchen-items'

const item = { id: 'one', kind: 'sink' as const, xCm: 0, yCm: 0, widthCm: 60, depthCm: 60 }
const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 300,
  heightCm: 300,
  warnings: [],
  rooms: [
    {
      name: 'Кухня',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 300, yCm: 0 },
        { xCm: 300, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
    },
  ],
  walls: [{ id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 300, yCm: 0 } }],
  openings: [],
}
describe('кухонные модули', () => {
  it('разрешает касание стены, но замечает пересечение внутренней стены', () => {
    expect(kitchenItemIssues([item], 300, 300, geometry)).toEqual([])
    expect(
      kitchenItemIssues([item], 300, 300, {
        ...geometry,
        walls: [
          { id: 'inner', kind: 'inner', start: { xCm: 30, yCm: 0 }, end: { xCm: 30, yCm: 300 } },
        ],
      }).join(' '),
    ).toContain('пересекает линию стены')
  })
  it('проверяет проём у стены и не объявляет окно непроходимой дверью', () => {
    const opening = { id: 'one', wallId: 'top', offsetCm: 10, widthCm: 80, type: 'door' as const }
    expect(
      kitchenItemIssues([item], 300, 300, { ...geometry, openings: [opening] }).join(' '),
    ).toContain('дверного проёма')
    expect(
      kitchenItemIssues([item], 300, 300, {
        ...geometry,
        openings: [{ ...opening, type: 'window' }],
      }).join(' '),
    ).toContain('высоту подоконника')
    expect(
      kitchenItemIssues([{ ...item, xCm: 100 }], 300, 300, { ...geometry, openings: [opening] }),
    ).toEqual([])
  })
  it('разрешает низкий модуль под проверенным подоконником', () => {
    const window = {
      id: 'window',
      wallId: 'top',
      offsetCm: 0,
      widthCm: 80,
      type: 'window' as const,
      sillHeightCm: 90,
    }
    expect(
      kitchenItemIssues([{ ...item, heightCm: 89 }], 300, 300, {
        ...geometry,
        openings: [window],
      }),
    ).toEqual([])
    expect(
      kitchenItemIssues([{ ...item, heightCm: 90 }], 300, 300, {
        ...geometry,
        openings: [window],
      }).join(' '),
    ).toContain('не помещается под подоконником')
  })
  it('не считает полотно квартирой при отсутствии контуров', () => {
    expect(kitchenItemIssues([item], 300, 300, { ...geometry, rooms: [] }).join(' ')).toContain(
      'не найден контур',
    )
  })
  it('отклоняет выход за комнату внутри общего полотна', () => {
    expect(kitchenItemIssues([{ ...item, xCm: 270 }], 600, 600, geometry).join(' ')).toContain(
      'не найден контур',
    )
  })
  it('проверяет диагональную стену и отрицательные координаты', () => {
    expect(
      kitchenItemIssues([item], 300, 300, {
        ...geometry,
        walls: [
          { id: 'diagonal', kind: 'inner', start: { xCm: 0, yCm: 0 }, end: { xCm: 300, yCm: 300 } },
        ],
      }).join(' '),
    ).toContain('пересекает линию стены')
    expect(kitchenItemIssues([{ ...item, xCm: -1 }], 300, 300).join(' ')).toContain('границы')
  })
  it('принимает соседние секции без пересечения', () => {
    expect(kitchenItemIssues([item, { ...item, id: 'two', xCm: 60 }], 300, 300)).toEqual([])
  })
  it('обнаруживает наложение и выход за полотно', () => {
    expect(kitchenItemIssues([item, { ...item, id: 'two', xCm: 50 }], 100, 300)).toHaveLength(2)
  })
  it('не разрешает поставить модуль на колонну или шахту', () => {
    expect(
      kitchenItemIssues([item], 300, 300, {
        ...geometry,
        obstacles: [
          {
            id: 'manual_0123456789abcdef01234567',
            kind: 'column',
            xCm: 20,
            yCm: 20,
            widthCm: 30,
            depthCm: 30,
          },
        ],
      }).join(' '),
    ).toContain('неподвижное препятствие')
  })
  it('отвергает нечисловые размеры и повторные ID на сервере', () => {
    expect(kitchenItemsSchema.safeParse([{ ...item, widthCm: Number.NaN }]).success).toBe(false)
    expect(kitchenItemsSchema.safeParse([item, item]).success).toBe(false)
    expect(kitchenItemsSchema.parse([item])).toEqual([item])
    expect(
      kitchenItemsSchema.parse([
        { ...item, id: 'oven', kind: 'oven' },
        { ...item, id: 'dishwasher', kind: 'dishwasher', xCm: 60 },
      ]),
    ).toHaveLength(2)
  })
})
