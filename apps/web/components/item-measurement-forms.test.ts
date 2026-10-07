import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/shopping', () => ({
  setItemSize: vi.fn(),
  resetItemSize: vi.fn(),
  setItemOperationClearance: vi.fn(),
  setItemPlacement: vi.fn(),
}))

import { ItemOperationForm } from './item-operation-form'
import { ItemPlacementForm } from './item-placement-form'
import { ItemSizeForm } from './item-size-form'

describe('формы дробных мерок', () => {
  it('показывает реальные габариты и координаты без округления', () => {
    const html = renderToStaticMarkup(
      createElement(ItemPlacementForm, {
        itemId: 'item',
        title: 'Стул',
        widthCm: 105.6,
        depthCm: 70.4,
        xCm: 220.4,
        yCm: 200.2,
        rotation: 90,
      }),
    )
    expect(html).toContain('Габарит 105.6 × 70.4 см')
    expect(html).toContain('value="220.4"')
    expect(html).toContain('value="200.2"')
    expect(html.match(/inputMode="decimal"/g)).toHaveLength(2)
  })

  it('предлагает десятичную клавиатуру для размеров и рабочей зоны', () => {
    const size = renderToStaticMarkup(
      createElement(ItemSizeForm, {
        itemId: 'item',
        title: 'Стул',
        width: 105.6,
        depth: 70.4,
        height: 85.2,
        canReset: true,
      }),
    )
    const operation = renderToStaticMarkup(
      createElement(ItemOperationForm, {
        itemId: 'item',
        title: 'Стул',
        kind: 'front',
        valueCm: 50.4,
      }),
    )
    expect(size.match(/inputMode="decimal"/g)).toHaveLength(3)
    expect(size).toContain('value="105.6"')
    expect(size).toContain('value="85.2"')
    expect(size).toContain('Убрать свои размеры')
    expect(operation).toContain('inputMode="decimal"')
    expect(operation).toContain('value="50.4"')
  })
})
