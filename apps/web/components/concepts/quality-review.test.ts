import type { ConceptQualityReview } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QualityReview } from './quality-review'

const reviewed: ConceptQualityReview = {
  version: 1,
  status: 'checked',
  model: 'test-model',
  checkedAt: '2026-09-27T00:00:00Z',
  description: 'Тестовый интерьер',
  issues: [],
}

function render(review: ConceptQualityReview | null, edited = false) {
  return renderToStaticMarkup(createElement(QualityReview, { review, edited }))
}

describe('concept quality explanation', () => {
  it('offers a source comparison when no automatic review exists', () => {
    const html = render(null)
    expect(html).toContain('Концепт готов к просмотру')
    expect(html).toContain('автосверка не выполнялась')
    expect(html).toContain('сравните важные детали с исходным планом или фото')
    expect(html).not.toContain('Автосверка выполнена')
  })

  it('does not carry a previous review over to an edited image', () => {
    const html = render(reviewed, true)
    expect(html).toContain('Цвета обновлены')
    expect(html).toContain('новая автосверка не выполнялась')
    expect(html).not.toContain('Автосверка выполнена')
  })

  it('keeps the unavailable state distinct from a completed review', () => {
    const html = render({ ...reviewed, status: 'unavailable' })
    expect(html).toContain('Концепт сохранён')
    expect(html).toContain('Автосверка сейчас недоступна')
    expect(html).not.toContain('Автосверка выполнена')
  })

  it('shows issues verbatim while keeping image review separate from dimensional checks', () => {
    const html = render({
      ...reviewed,
      status: 'review',
      issues: [
        { code: 'opening_conflict', detail: 'Окно слева заменено стеной.', confidence: 0.9 },
      ],
    })
    expect(html).toContain('посмотрите отмеченные детали')
    expect(html).toContain('Окно слева заменено стеной.')
    expect(html).toContain('Размеры и размещение мебели проверяются отдельно')
  })

  it('does not present an empty issue list as confirmation of every detail', () => {
    const html = render(reviewed)
    expect(html).toContain('Автосверка не нашла замечаний')
    expect(html).toContain('отсутствие замечаний не подтверждает каждую деталь')
    expect(html).toContain('по плану и меркам')
  })
})
