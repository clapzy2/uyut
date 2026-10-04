import { layoutRoom } from '@uyut/catalog'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExportComposition, exportRoomComposition } from './export-composition'

type Candidate = Parameters<typeof exportRoomComposition>[1][number]
type Item = Parameters<typeof exportRoomComposition>[3][number]

const room = { id: 'living', name: 'Гостиная', areaM2: 18, conceptCount: 5 }

function concept(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    roomId: room.id,
    status: 'ready',
    likedByOwner: true,
    createdAt: new Date('2026-10-04T10:00:00Z'),
    renderUrl: `${id}.jpg`,
    editedRenderUrl: null,
    ...overrides,
  }
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    roomId: room.id,
    quantity: 1,
    variant: null,
    catalogNotice: null,
    dimensionsCm: { width: 120, depth: 60 },
    ...overrides,
  }
}

function markup(compositionRooms: ReturnType<typeof exportRoomComposition>[], items: Item[] = []) {
  return renderToStaticMarkup(
    createElement(ExportComposition, { projectId: 'project', rooms: compositionRooms, items }),
  )
}

describe('PDF composition before checkout', () => {
  it('selects a ready shopping concept over a newer owner like and caps liked alternatives at three', () => {
    const candidates = [
      concept('shopping', { likedByOwner: false }),
      ...['a', 'b', 'c', 'd'].map((id) =>
        concept(id, { createdAt: new Date('2026-10-04T12:00:00Z') }),
      ),
    ]
    const composition = exportRoomComposition(
      room,
      candidates,
      [{ id: 'object', conceptId: 'shopping' }],
      [],
      null,
    )
    expect(composition.mainId).toBe('shopping')
    expect(composition.mainFromShopping).toBe(true)
    expect(composition.alternateCount).toBe(3)
    expect(markup([composition])).toContain('откуда выбрано больше всего предметов')
    expect(markup([composition])).toContain('/projects/project/rooms/living/concepts/shopping')
  })

  it('counts distinct selected objects rather than duplicate shopping rows or quantities', () => {
    const composition = exportRoomComposition(
      room,
      [concept('a'), concept('b')],
      [
        { id: 'one', conceptId: 'a' },
        { id: 'one', conceptId: 'a' },
        { id: 'one', conceptId: 'a' },
        { id: 'two', conceptId: 'b' },
        { id: 'three', conceptId: 'b' },
      ],
      [item({ quantity: 9 })],
      null,
    )
    expect(composition.mainId).toBe('b')
  })

  it('falls back to the latest owner like, excludes pending and unliked candidates', () => {
    const composition = exportRoomComposition(
      room,
      [
        concept('old'),
        concept('new', { createdAt: new Date('2026-10-04T11:00:00Z') }),
        concept('pending', { status: 'pending' }),
        concept('unliked', { likedByOwner: false }),
      ],
      [{ id: 'object', conceptId: 'pending' }],
      [],
      null,
    )
    expect(composition.mainId).toBe('new')
    expect(composition.mainFromShopping).toBe(false)
    expect(composition.alternateCount).toBe(1)
  })

  it('distinguishes a measured room without an interior from a room without any content', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 450 }, [])
    const measured = exportRoomComposition(room, [], [], [], layout)
    expect(measured.hasRoomSection).toBe(true)
    expect(markup([measured])).toContain('2D-схема по сохранённым меркам')
    expect(markup([measured])).not.toContain('Отдельного раздела комнаты пока не будет')

    const empty = exportRoomComposition(
      { ...room, name: 'Кухня <уточнить>', areaM2: null },
      [],
      [],
      [],
      null,
    )
    const html = markup([empty])
    expect(empty.hasRoomSection).toBe(false)
    expect(html).toContain('Кухня &lt;уточнить&gt;')
    expect(html).toContain('Отдельного раздела комнаты пока не будет')
    expect(html).toContain('Площадь не указана — работы не включены в смету')
    expect(html).toContain('Готовые варианты есть')
    expect(html).toContain('/projects/project/rooms/living')
    expect(html).not.toContain('<button')
  })

  it('reports positions, quantities, selected variants and loose items independently', () => {
    const items = [
      item({ quantity: 4, variant: { color: 'Бежевый', priceKopecks: 20_000 } }),
      item({ roomId: null, dimensionsCm: null, catalogNotice: 'Вариант удалён' }),
    ]
    const composition = exportRoomComposition(room, [], [], items, null)
    const html = markup([composition], items)
    expect(html).toContain('2 позиции · 5 предметов')
    expect(html).toContain('Позиций с выбранным вариантом: 1')
    expect(html).toContain('Без привязки к комнате: 1 позиция')
    expect(html).toContain('В покупках: 1 позиция')
    expect(html).toContain('Без ширины или глубины: 1')
    expect(html).toContain('Позиций с замечанием к данным каталога: 1')
  })

  it('does not promise images, a brief, room sections or a page count before assembly', () => {
    const composition = exportRoomComposition(
      room,
      [concept('missing-image', { renderUrl: null })],
      [],
      [],
      null,
    )
    const html = markup([composition])
    expect(html).toContain('Изображение основного интерьера отсутствует')
    expect(html).toContain('Бесплатный PDF может выйти без него')
    expect(html).toContain('изображения можно проверить после сборки')
    expect(html).toContain('список покупок в PDF будет пустым')
    expect(html).toContain('3D-просмотр, инженерные чертежи')
    expect(html).not.toMatch(/\d+ стр\./)
  })
})
