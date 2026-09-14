import type { ConceptQualityReview } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QualityReview } from '../../components/concepts/quality-review'

const review: ConceptQualityReview = {
  version: 1,
  status: 'review',
  model: 'test',
  checkedAt: '2026-09-14T00:00:00Z',
  description: null,
  issues: [{ code: 'requirement_unconfirmed', detail: 'Видно два места.', confidence: 0.9 }],
}

describe('предупреждения качества', () => {
  it('неподтверждённое пожелание не выдаётся за доказанную ошибку', () => {
    const html = renderToStaticMarkup(createElement(QualityReview, { review, edited: false }))
    expect(html).toContain('Пожелание требует проверки')
    expect(html).toContain('Видно два места.')
    expect(html).not.toContain('есть возможные ошибки')
  })
  it('после перекраски не показывает старый отчёт', () => {
    const html = renderToStaticMarkup(createElement(QualityReview, { review, edited: true }))
    expect(html).toContain('не проверялась автоматически')
    expect(html).not.toContain('Видно два места.')
  })
  it('экранирует текст модели', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: {
          ...review,
          issues: [
            {
              code: 'requirement_unconfirmed',
              confidence: 0.9,
              detail: '<script>alert(1)</script>',
            },
          ],
        },
        edited: false,
      }),
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
