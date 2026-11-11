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
  it('shows incomplete image assessment even when the photo comparison succeeded', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: {
          ...review,
          status: 'checked',
          issues: [],
          imageReview: 'limited',
          sourceComparison: 'verified',
        },
        edited: false,
      }),
    )
    expect(html).toContain('Проверка изображения неполная')
    expect(html).not.toContain('Автосверка не нашла замечаний')
  })

  it.each(['verified', undefined] as const)(
    'keeps previous opening findings visible after the plan changes, comparison=%s',
    (sourceComparison) => {
      const html = renderToStaticMarkup(
        createElement(QualityReview, {
          review: {
            ...review,
            sourceComparison,
            issues: [
              { code: 'opening_conflict', detail: 'Добавлен проём слева.', confidence: 0.9 },
            ],
          },
          edited: false,
          planStatus: 'changed',
        }),
      )
      expect(html).toContain('Добавлен проём слева.')
      expect(html).toContain('их соответствие новому плану не проверено')
      expect(html).not.toContain('Автосверка изображения выполнена')
    },
  )

  it('shows incomplete comparison instead of a clean verdict when no defect was confirmed', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: { ...review, status: 'checked', issues: [], sourceComparison: 'limited' },
        edited: false,
      }),
    )
    expect(html).toContain('Сравнение неполное')
    expect(html).toContain('вручную')
    expect(html).not.toContain('Автосверка не нашла замечаний')
  })

  it('renders all merged findings and the end of a long confirmed detail', () => {
    const detail = `${'Первое замечание. '.repeat(20)}Добавлен радиатор под окном.`
    const merged: ConceptQualityReview = {
      ...review,
      issues: [
        { code: 'not_interior', detail: 'Нужно сверить содержимое.', confidence: 0.9 },
        { code: 'wrong_room', detail: 'Нужно сверить комнату.', confidence: 0.9 },
        { code: 'broken_geometry', detail: 'Нужно сверить форму.', confidence: 0.9 },
        { code: 'blocked_access', detail: 'Нужно сверить проход.', confidence: 0.9 },
        { code: 'brief_conflict', detail, confidence: 0.9 },
        { code: 'opening_conflict', detail: 'Добавлен дверной проём.', confidence: 0.9 },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(QualityReview, { review: merged, edited: false }),
    )
    expect(html.match(/<li\b/g)).toHaveLength(6)
    expect(html).toContain('Добавлен радиатор под окном.')
    expect(html).toContain('Добавлен дверной проём.')
  })

  it('неподтверждённое пожелание не выдаётся за доказанную ошибку', () => {
    const html = renderToStaticMarkup(createElement(QualityReview, { review, edited: false }))
    expect(html).toContain('Пожелание требует проверки')
    expect(html).toContain('Видно два места.')
    expect(html).not.toContain('есть возможные ошибки')
  })
  it('после перекраски не показывает старый отчёт', () => {
    const html = renderToStaticMarkup(createElement(QualityReview, { review, edited: true }))
    expect(html).toContain('новая автосверка не выполнялась')
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
