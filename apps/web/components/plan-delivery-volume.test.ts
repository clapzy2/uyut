import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DeliveryVolumeScene } from '@/lib/projects/plan-delivery-volume'
import type { FurnitureDeliveryResult } from '@/lib/projects/plan-furniture-delivery'
import type { FurnitureDeliveryReportRequest } from '@/lib/projects/plan-furniture-delivery-report'

const state = vi.hoisted(() => ({ scene: null as DeliveryVolumeScene | null }))
vi.mock('@/lib/projects/plan-delivery-volume', async (original) => ({
  ...(await original<typeof import('@/lib/projects/plan-delivery-volume')>()),
  deliveryVolumeScene: () => state.scene,
}))

import PlanDeliveryVolume from './plan-delivery-volume'

function render() {
  return renderToStaticMarkup(
    createElement(PlanDeliveryVolume, {
      geometry: {} as PlanGeometry,
      request: {} as FurnitureDeliveryReportRequest,
      result: {} as FurnitureDeliveryResult,
    }),
  )
}
function scene(): DeliveryVolumeScene {
  const from = { xCm: 0, yCm: 0, zCm: -10 }
  const to = { xCm: 100, yCm: 0, zCm: 20 }
  return {
    datum: 'entry-datum',
    surfaces: [],
    leaves: [],
    ceilingPoints: [{ xCm: 0, yCm: 0, zCm: 250 }],
    routes: [{ id: 'exterior', points: [from, to] }],
    stages: [
      {
        kind: 'lift',
        from,
        to,
        bounds: {
          leftCm: -20,
          topCm: -20,
          rightCm: 120,
          bottomCm: 20,
          bottomElevationCm: -10,
          topElevationCm: 90,
        },
      },
    ],
  }
}

describe('delivery 3D measured viewer', () => {
  it('states missing verified levels without showing an invented volume', () => {
    state.scene = null
    const html = render()
    expect(html).toContain('3D маршрута недоступен')
    expect(html).not.toContain('<svg')
  })
  it('labels the checked enclosure, full route and common datum without physical animation promises', () => {
    state.scene = scene()
    const html = render()
    expect(html).toContain('Показ проверенных объёмов, не физическая симуляция доставки')
    expect(html).toContain('entry-datum')
    expect(html).toContain('Наружный занос')
    expect(html).toContain('Проверенный объём по Z')
    expect(html).toContain('-10')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('<animate')
  })
  it('provides labelled range controls and touch sized manual stage buttons', () => {
    state.scene = scene()
    const html = render()
    expect(html.match(/type="range"/g)).toHaveLength(4)
    expect(html).toContain('Поворот вида, градусы')
    expect(html).toContain('Наклон вида, градусы')
    expect(html).toContain('Масштаб вида')
    expect(html).toContain('Предыдущий этап')
    expect(html).toContain('Следующий этап')
    expect(html).toContain('min-h-11')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('w-full')
  })
})
