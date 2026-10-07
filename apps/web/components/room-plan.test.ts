import { layoutRoom } from '@uyut/catalog'
import { createElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RoomItemSizes, RoomPlan, RoomPlanDrawing } from './room-plan'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/plan-volume-launch', () => ({ PlanVolumeLaunch: () => null }))

describe('подписи дробных мерок на схеме комнаты', () => {
  it('оставляет редактирование своих габаритов доступным после размещения и без плана комнаты', () => {
    const html = renderToStaticMarkup(
      createElement(RoomItemSizes, {
        items: [
          { id: 'sofa', title: 'Диван', ownDimensionsCm: { width: 210, depth: 90 } },
          { id: 'chair', title: 'Стул', ownDimensionsCm: null },
        ],
      }),
    )
    expect(html).toContain('Габариты выбранных товаров · 2')
    expect(html).toContain('value="210"')
    expect(html).toContain('Убрать свои размеры')
    expect(html.match(/Убрать свои размеры/g)).toHaveLength(2)
  })
  it('передаёт SVG-подсказки одним текстовым узлом для гидратации', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 500 }, [
      {
        id: 'table',
        title: 'Столик журнальный',
        category: 'table',
        subcategory: 'coffee',
        quantity: 1,
        dimensions: { width: 100, depth: 60 },
      },
    ])
    expect(layout.functionalZones.length).toBeGreaterThan(0)
    const drawing = renderToString(createElement(RoomPlanDrawing, { layout }))
    const titles = [...drawing.matchAll(/<title>(.*?)<\/title>/g)].map((match) => match[1] ?? '')
    expect(titles.some((title) => title.includes('рабочая зона'))).toBe(true)
    expect(titles.every((title) => !title.includes('<!--'))).toBe(true)
  })

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
