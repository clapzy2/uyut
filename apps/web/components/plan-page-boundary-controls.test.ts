import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PlanPageBoundaryControls } from './plan-page-boundary-controls'

const polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 0, y: 100 },
]
const controls = {
  disabled: false,
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onRole: vi.fn(),
  editing: undefined,
  floor: undefined,
}

describe('separate source floor controls', () => {
  it('offers separate floor only beside an explicitly classified exterior envelope', () => {
    const html = renderToStaticMarkup(
      createElement(PlanPageBoundaryControls, {
        ...controls,
        exterior: { polygon, boundaryRole: 'outer-wall-envelope' },
      }),
    )
    expect(html).toContain('Добавить границу пола')
    expect(html).toContain('Толщина стен не вычитается автоматически')
    const legacy = renderToStaticMarkup(
      createElement(PlanPageBoundaryControls, {
        ...controls,
        exterior: { polygon, boundaryRole: 'floor' },
      }),
    )
    expect(legacy).not.toContain('Добавить границу пола')
  })

  it('keeps an existing floor visible if the exterior role is removed instead of silently losing it', () => {
    const html = renderToStaticMarkup(
      createElement(PlanPageBoundaryControls, {
        ...controls,
        exterior: undefined,
        floor: { polygon },
      }),
    )
    expect(html).toContain('Удалить границу пола')
    expect(html).toContain('Восстановите')
    expect(html).toContain('3 вершин')
  })
})
