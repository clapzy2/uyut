import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('@/actions/plan-source-room-numbers', () => ({
  getPlanSourceRoomNumberOptions: actions.load,
  savePlanSourceRoomNumbers: actions.save,
}))

import { PlanSourceRoomNumberRecovery } from './plan-source-room-number-recovery'

const render = (disabled = false) =>
  renderToStaticMarkup(
    createElement(PlanSourceRoomNumberRecovery, {
      projectId: 'project',
      revision: 'revision',
      disabled,
      onSaved: vi.fn(),
      onConflict: vi.fn(),
      onPendingChange: vi.fn(),
    }),
  )

describe('explicit missing source-number recovery UI', () => {
  it('loads nothing automatically and states the limited metadata-only scope', () => {
    const html = render()
    expect(html).toContain('Проверить отсутствующие номера')
    expect(html).toContain('Размеры, высоты, контуры и существующие номера не заменяются')
    expect(html).toContain('Это не перенос геометрии в 2D/3D')
    expect(actions.load).not.toHaveBeenCalled()
    expect(actions.save).not.toHaveBeenCalled()
    expect(html).not.toContain('Восстановить выбранные номера')
    expect(html).not.toContain('checked=')
  })
  it('blocks source recovery while a different edit owns the form', () => {
    const html = render(true)
    expect(html).toMatch(/<button[^>]*disabled/)
    expect(html).toContain('Сначала завершите текущую правку или закройте разметку листа')
    expect(actions.save).not.toHaveBeenCalled()
  })
})
