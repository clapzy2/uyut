import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PlanReviewForm } from '../../components/concepts/plan-review-form'

describe('manual plan review form', () => {
  it('offers a separate not-visible answer for each plan fact', () => {
    const html = renderToStaticMarkup(
      createElement(PlanReviewForm, {
        conceptId: 'concept',
        sourceHash: 'hash',
        openingLabels: ['Окно 1 — сверху', 'Дверь 2 — слева'],
        review: null,
      }),
    )
    expect(html).toContain('Форма комнаты')
    expect(html).toContain('Окно 1 — сверху')
    expect(html).toContain('Дверь 2 — слева')
    expect(html).toContain('Проёмы, которых нет на плане')
    expect(html).toContain('Виден лишний проём')
    expect(html).toContain('Ракурс не позволяет проверить')
    expect(html).toContain('Сохранить сверку')
  })
})
