import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('@/actions/plan-floor-height-review', () => ({
  getPlanFloorHeightReviewOptions: actions.load,
  savePlanFloorHeightReview: actions.save,
}))

import { PlanFloorHeightReviewEditor } from './plan-floor-height-review'

describe('explicit room-height review UI', () => {
  it('loads only after an explicit click and explains source association limits', () => {
    const html = renderToStaticMarkup(
      createElement(PlanFloorHeightReviewEditor, {
        projectId: 'test',
        revision: 'a'.repeat(64),
        onSaved: vi.fn(),
        onConflict: vi.fn(),
      }),
    )
    expect(html).toContain('Получить исходные подписи высот')
    expect(html).toContain('не подтверждение чистового потолка')
    expect(html).toContain('общий ноль квартиры')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('Сохранить привязку высот как черновик')
    expect(actions.load).not.toHaveBeenCalled()
    expect(actions.save).not.toHaveBeenCalled()
  })
  it('disables source loading while another plan action owns the revision', () => {
    const html = renderToStaticMarkup(
      createElement(PlanFloorHeightReviewEditor, {
        projectId: 'test',
        revision: 'a'.repeat(64),
        disabled: true,
        onSaved: vi.fn(),
        onConflict: vi.fn(),
      }),
    )
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/)
  })
})
