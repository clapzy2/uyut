import type { PlanGeometry } from '@uyut/db'
import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { PlanRouteCheck } from './plan-route-check'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 200,
  heightCm: 200,
  walls: [],
  openings: [],
  warnings: [],
  rooms: [
    {
      name: 'Комната',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 200, yCm: 0 },
        { xCm: 200, yCm: 200 },
      ],
    },
  ],
}
const checked = {
  snapshot: JSON.stringify(geometry),
  inspection: {
    result: {
      widthCm: 70,
      stepCm: 10,
      footprint: 'axis-aligned-square',
      status: 'constructive-routes',
      checkedNodes: 1,
      unresolvedRoomIds: [],
      routes: [
        {
          roomId: '0',
          points: [
            { xCm: 70, yCm: 70 },
            { xCm: 80, yCm: 70 },
          ],
        },
      ],
    },
  },
}

function render(current: PlanGeometry, saved = checked) {
  vi.mocked(useState)
    .mockReturnValueOnce([saved, vi.fn()])
    .mockReturnValueOnce([undefined, vi.fn()])
  return renderToStaticMarkup(createElement(PlanRouteCheck, { geometry: current }))
}

it('shows route lines only for the checked geometry snapshot', () => {
  expect(render(geometry)).toContain('<polyline')
})

it('labels signed continuous routes and held step transitions without a passability verdict', () => {
  const saved = {
    ...checked,
    inspection: {
      result: {
        ...checked.inspection.result,
        vertical: {
          referenceId: 'synthetic-zero',
          elevationCm: -15,
          heldTransitions: [
            {
              openingIds: ['balcony-in', 'balcony-out'],
              reason: 'Разные отметки полов: преодоление ступени не проверяется.',
            },
          ],
        },
      },
    },
  }
  const html = render(geometry, saved)
  expect(html).toContain('Непрерывные пути на отметке -15 см')
  expect(html).toContain('synthetic-zero')
  expect(html).toContain('внешний порог не проверяется')
  expect(html).toContain('Требуют сверки переходы: 1')
  expect(html).toContain('balcony-in, balcony-out')
  expect(html).toContain('не подтверждение вертикального просвета')
})

it('hides old route lines immediately after an obstacle edit', () => {
  const html = render({
    ...geometry,
    obstacles: [{ id: 'column', kind: 'column', xCm: 50, yCm: 50, widthCm: 20, depthCm: 20 }],
  })
  expect(html).not.toContain('<polyline')
  expect(html).not.toContain('Стартовая свободная зона')
  expect(html).toContain('Схема изменилась')
})

it('hides old route lines after the requested width changes', () => {
  expect(render({ ...geometry, routeWidthCm: 100 })).not.toContain('<polyline')
})

it('shows the start footprint even when the only route has one point', () => {
  const html = render(geometry, {
    ...checked,
    inspection: {
      result: {
        ...checked.inspection.result,
        routes: [{ roomId: '0', points: [{ xCm: 70, yCm: 70 }] }],
      },
    },
  })
  expect(html).toContain('Стартовая свободная зона')
  expect(html).toContain('x="35" y="35" width="70" height="70"')
  expect(html).toContain('<circle cx="70" cy="70"')
})

it('explains that even a current route is only a horizontal footprint, not head clearance or carrying proof', () => {
  const html = render(geometry)
  expect(html).toContain('Горизонтальная 2D-проверка')
  expect(html).toContain('Высота над головой, перенос мебели и преодоление ступеней не проверяются')
  expect(html).toContain('не подтверждение вертикального просвета или физического переноса мебели')
})

it('distinguishes unknown and raised door bottoms without treating a window sill as a route threshold', () => {
  const source: PlanGeometry = {
    ...geometry,
    openings: [
      { id: 'unknown-door', type: 'door', wallId: 'wall', offsetCm: 0, widthCm: 90 },
      {
        id: 'raised-balcony',
        type: 'balcony',
        wallId: 'wall',
        offsetCm: 0,
        widthCm: 90,
        bottomCm: 12,
      },
      {
        id: 'window-sill',
        type: 'window',
        wallId: 'wall',
        offsetCm: 0,
        widthCm: 90,
        bottomCm: 100,
      },
    ],
  }
  const before = structuredClone(source)
  const html = render(source)
  expect(html).toContain('Неизвестная нижняя грань у дверных и балконных проёмов: 1')
  expect(html).toContain('условными 2D-кандидатами, не доказательством непрерывного ровного пола')
  expect(html).toContain('Поднятая нижняя грань: 1')
  expect(html).toContain('маршрут через ступень здесь не проверяется')
  expect(html).toContain('Не указаны: unknown-door')
  expect(html).toContain('Подняты над полом: raised-balcony')
  expect(html).not.toContain('window-sill')
  expect(html).not.toContain('<polyline')
  expect(html).not.toContain('Сохранить')
  expect(source).toEqual(before)
})

it('does not show unknown or raised warnings for explicitly floor-level doors', () => {
  const html = render({
    ...geometry,
    openings: [
      {
        id: 'floor-door',
        type: 'door',
        wallId: 'wall',
        offsetCm: 0,
        widthCm: 90,
        bottomCm: 0,
        heightCm: 210,
      },
    ],
  })
  expect(html).not.toContain('Неизвестная нижняя грань у дверных')
  expect(html).not.toContain('Поднятая нижняя грань:')
  expect(html).toContain('Высота над головой, перенос мебели')
})

it.each(['bottomCm', 'heightCm'] as const)(
  'invalidates a checked route when opening %s changes',
  (field) => {
    const original: PlanGeometry = {
      ...geometry,
      openings: [
        {
          id: 'door',
          type: 'door',
          wallId: 'wall',
          offsetCm: 0,
          widthCm: 90,
          bottomCm: 0,
          heightCm: 210,
        },
      ],
    }
    const saved = { ...checked, snapshot: JSON.stringify(original) }
    const current = structuredClone(original)
    const opening = current.openings[0]
    if (!opening) throw new Error('Opening fixture is missing')
    opening[field] = field === 'bottomCm' ? 5 : 205
    const html = render(current, saved)
    expect(html).toContain('Схема изменилась')
    expect(html).not.toContain('<polyline')
    expect(html).not.toContain('Стартовая свободная зона')
  },
)
