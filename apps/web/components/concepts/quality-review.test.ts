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
  it('does not direct the person to a missing plan-comparison section', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: reviewed,
        edited: false,
        planStatus: 'unlinked',
        canComparePlan: false,
      }),
    )
    expect(html).toContain('Сверьте окна, двери и контур с исходным планом или фото комнаты')
    expect(html).not.toContain('разделе «Сверить концепт с планом»')
  })

  it('offers a source comparison when no automatic review exists', () => {
    const html = render(null)
    expect(html).toContain('Автосверка не выполнялась')
    expect(html).toContain('Сверьте окна и двери с исходным планом или фото')
    expect(html).not.toContain('Автосверка изображения выполнена')
  })

  it('does not carry a previous review over to an edited image', () => {
    const html = render(reviewed, true)
    expect(html).toContain('Цвета обновлены')
    expect(html).toContain('новая автосверка не выполнялась')
    expect(html).not.toContain('Автосверка изображения выполнена')
  })

  it('keeps the unavailable state distinct from a completed review', () => {
    const html = render({ ...reviewed, status: 'unavailable' })
    expect(html).toContain('Автосверка сейчас недоступна')
    expect(html).not.toContain('Автосверка изображения выполнена')
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
    expect(html).toContain('не подтверждает каждую деталь')
    expect(html).toContain('по плану и меркам')
  })

  it('keeps every reported issue visible outside the collapsed methodology', () => {
    const html = render({
      ...reviewed,
      status: 'review',
      issues: [
        { code: 'opening_conflict', detail: 'Окно слева заменено стеной.', confidence: 0.9 },
        { code: 'requirement_unconfirmed', detail: 'Рабочий стол не виден.', confidence: 0.8 },
      ],
    })
    const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0]
    expect(details).toContain('Что проверяет автосверка')
    expect(details).not.toContain('Окно слева заменено стеной.')
    expect(details).not.toMatch(/<details[^>]*\bopen(?:[\s=>])/)
    const outsideDetails = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    expect(outsideDetails).toContain('Окно слева заменено стеной.')
    expect(outsideDetails).toContain('Пожелание требует проверки. Рабочий стол не виден.')
  })

  it('marks a changed plan and hides only superseded architecture comments', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: {
          ...reviewed,
          status: 'review',
          issues: [
            { code: 'opening_conflict', detail: 'Старое окно слева.', confidence: 0.9 },
            { code: 'blocked_access', detail: 'Стол перекрывает видимую дверь.', confidence: 0.9 },
          ],
        },
        edited: false,
        planStatus: 'changed',
      }),
    )
    expect(html).toContain('Сверьте концепт с актуальными данными плана')
    expect(html).toContain('Стол перекрывает видимую дверь.')
    expect(html).not.toContain('Старое окно слева.')
    expect(html).not.toContain('Автосверка не нашла замечаний')
  })

  it('does not claim legacy reviews were checked against the current plan', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: reviewed,
        edited: false,
        planStatus: 'unlinked',
      }),
    )
    expect(html).toContain('Эта автосверка не привязана к текущему плану')
    expect(html).toContain('Версия плана для этой автосверки не сохранена')
    expect(html).not.toContain('новой версии плана')
    expect(html).not.toContain('Автосверка не нашла замечаний')
  })

  it('keeps legacy opening observations visible when their source is unknown', () => {
    const html = renderToStaticMarkup(
      createElement(QualityReview, {
        review: {
          ...reviewed,
          status: 'review',
          issues: [
            {
              code: 'opening_conflict',
              detail: 'На исходном фото видна другая дверь.',
              confidence: 0.9,
            },
          ],
        },
        edited: false,
        planStatus: 'unlinked',
      }),
    )
    expect(html).toContain('На исходном фото видна другая дверь.')
    expect(html).toContain('Эта автосверка не привязана к текущему плану')
  })
})
