import { layoutRoom } from '@uyut/catalog'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RoomPlan, RoomPlanDrawing } from './room-plan'

vi.mock('@/components/plan-volume-launch', () => ({ PlanVolumeLaunch: () => null }))

describe('подписи дробных мерок на схеме комнаты', () => {
  it('показывает размер комнаты и мебели без округления до целого сантиметра', () => {
    const layout = layoutRoom({ widthCm: 400.3, depthCm: 500.4 }, [
      {
        id: 'chair',
        title: 'Стул',
        category: 'chair',
        quantity: 1,
        dimensions: { width: 105.6, depth: 70.4 },
      },
    ])
    const before = structuredClone(layout)
    const drawing = renderToStaticMarkup(createElement(RoomPlanDrawing, { layout }))
    expect(drawing).toContain('План комнаты 400.3 на 500.4 сантиметров')
    expect(drawing).toContain('105.6 × 70.4')
    const page = renderToStaticMarkup(createElement(RoomPlan, { layout, projectId: 'project' }))
    expect(page).toContain('400.3 × 500.4 см')
    expect(layout.widthCm).toBe(400.3)
    expect(layout).toEqual(before)
  })
})
