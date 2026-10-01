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

function render(current: PlanGeometry) {
  vi.mocked(useState)
    .mockReturnValueOnce([checked, vi.fn()])
    .mockReturnValueOnce([undefined, vi.fn()])
  return renderToStaticMarkup(createElement(PlanRouteCheck, { geometry: current }))
}

it('shows route lines only for the checked geometry snapshot', () => {
  expect(render(geometry)).toContain('<polyline')
})

it('hides old route lines immediately after an obstacle edit', () => {
  const html = render({
    ...geometry,
    obstacles: [{ id: 'column', kind: 'column', xCm: 50, yCm: 50, widthCm: 20, depthCm: 20 }],
  })
  expect(html).not.toContain('<polyline')
  expect(html).toContain('Схема изменилась')
})

it('hides old route lines after the requested width changes', () => {
  expect(render({ ...geometry, routeWidthCm: 100 })).not.toContain('<polyline')
})
