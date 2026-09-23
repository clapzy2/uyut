import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanComparison } from '../../components/concepts/plan-comparison'

const plan = {
  src: 'https://example.test/private-plan.webp',
  isPdf: false,
  label: 'План квартиры',
  architecture: {
    shape: 'nonrectangular' as const,
    openings: [
      { type: 'window' as const, side: 'top' as const },
      { type: 'door' as const, side: 'inner' as const },
    ],
  },
}

describe('сверка концепта с планом', () => {
  it('shows both images and plan facts without claiming pixel-level accuracy', () => {
    const html = renderToStaticMarkup(
      createElement(PlanComparison, { plan, renderSrc: 'https://example.test/render.webp' }),
    )
    expect(html).toContain('Сверить концепт с планом')
    expect(html).toContain('private-plan.webp')
    expect(html).toContain('render.webp')
    expect(html).toContain('непрямоугольный')
    expect(html).toContain('окно сверху')
    expect(html).toContain('дверь на внутренней стене')
    expect(html).toContain('по картинке нельзя проверить сантиметровые размеры')
  })

  it('does not present unconfirmed markings as facts', () => {
    const html = renderToStaticMarkup(
      createElement(PlanComparison, {
        plan: { ...plan, architecture: null },
        renderSrc: 'https://example.test/render.webp',
      }),
    )
    expect(html).toContain('Разметка этой комнаты ещё не подтверждена')
    expect(html).not.toContain('Что подтверждено на плане')
  })

  it('links a PDF instead of embedding it as an image', () => {
    const html = renderToStaticMarkup(
      createElement(PlanComparison, {
        plan: { ...plan, src: 'https://example.test/plan.pdf', isPdf: true },
        renderSrc: 'https://example.test/render.webp',
      }),
    )
    expect(html).toContain('Открыть план PDF')
    expect(html).not.toContain('src="https://example.test/plan.pdf"')
  })

  it('stays absent when either source is missing', () => {
    expect(
      renderToStaticMarkup(createElement(PlanComparison, { plan: null, renderSrc: 'x' })),
    ).toBe('')
    expect(renderToStaticMarkup(createElement(PlanComparison, { plan, renderSrc: null }))).toBe('')
  })
})
