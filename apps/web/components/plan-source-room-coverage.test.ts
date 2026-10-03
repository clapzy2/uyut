import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanSourceRoomCoverage } from './plan-source-room-coverage'

describe('помещения исходного листа после создания черновика', () => {
  const sourceRooms = [
    { name: 'Спальня', sourceNumber: 5 },
    { name: 'Спальня', sourceNumber: 6 },
  ]
  const rooms = [{ name: 'Спальня №05', sourceNumber: 5, polygon: [] }]
  const roomReadings = [{ name: 'Спальня №05', sourceNumber: 5 }]
  it('показывает пропуск из экспликации, даже если все импортированные контуры готовы', () => {
    const html = renderToStaticMarkup(
      createElement(PlanSourceRoomCoverage, { rooms, roomReadings, sourceRooms }),
    )
    expect(html).toContain('1 из 2 помещений')
    expect(html).toContain('№06 · Спальня')
    expect(html).toContain('добавьте в блок «Данные с чертежа»')
    expect(html).toContain('Черновик можно сохранить')
  })
  it('различает отсутствие списка и отсутствие контура, не придумывает размеры', () => {
    const html = renderToStaticMarkup(
      createElement(PlanSourceRoomCoverage, {
        rooms,
        roomReadings: [...roomReadings, { name: 'Спальня №06', sourceNumber: 6 }],
        sourceRooms,
      }),
    )
    expect(html).toContain('разметьте контур по исходному обмеру')
    expect(html).not.toContain('добавьте в блок')
    expect(html).not.toContain('см')
  })
  it('не показывает замечание для полной общей зоны и для неизвестной экспликации', () => {
    expect(
      renderToStaticMarkup(
        createElement(PlanSourceRoomCoverage, {
          rooms: [{ name: 'Общая зона', sourceNumbers: [5, 6], polygon: [] }],
          roomReadings: sourceRooms,
          sourceRooms,
        }),
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(
        createElement(PlanSourceRoomCoverage, { rooms, roomReadings, sourceRooms: [] }),
      ),
    ).toBe('')
  })
})
