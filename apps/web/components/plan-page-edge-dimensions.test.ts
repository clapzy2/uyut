import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  edgeDimensionFixture,
  required,
} from '../lib/projects/test-fixtures/plan-page-edge-dimensions'
import {
  contourDraftsFromSaved,
  dimensionLabelsFromResponse,
} from './plan-page-contour-editor-model'
import { PlanPageEdgeDimensions } from './plan-page-edge-dimensions'

describe('выбор подписанных сторон исходного PDF', () => {
  it('показывает сохранённый выбор и не предлагает ввод предполагаемой длины', () => {
    const f = edgeDimensionFixture()
    const html = renderToStaticMarkup(
      createElement(PlanPageEdgeDimensions, {
        draft: required(contourDraftsFromSaved([f.room])[0]),
        labels: f.labels,
        locked: false,
        onChange: () => {},
        onHighlight: () => {},
      }),
    )
    expect(html).toContain('Подписанные стороны для масштаба')
    expect(html).toContain('3000')
    expect(html).toContain('checked=""')
    expect(html).toContain('Выбрано сторон: 2')
    expect(html).not.toContain('type="number"')
  })

  it('проверяет индексы и координаты подписей приватного ответа', () => {
    const { labels } = edgeDimensionFixture()
    expect(dimensionLabelsFromResponse({ dimensionLabels: labels })).toEqual(labels)
    expect(dimensionLabelsFromResponse({ dimensionLabels: [] })).toEqual([])
    expect(dimensionLabelsFromResponse({})).toBeNull()
    for (const change of [
      { index: -1 },
      { index: 20_000 },
      { x: 1001 },
      { y: Number.NaN },
      { rotation: Infinity },
      { text: '1,5 м²' },
      { text: '0' },
    ])
      expect(
        dimensionLabelsFromResponse({ dimensionLabels: [{ ...labels[0], ...change }] }),
      ).toBeNull()
    expect(dimensionLabelsFromResponse({ dimensionLabels: [labels[0], labels[0]] })).toBeNull()
  })
})
