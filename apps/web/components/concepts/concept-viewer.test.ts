import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ConceptPageData, MatchView } from '@/lib/concepts/objects'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@uyut/ai', () => ({ findSwatch: vi.fn(), isApproximate: vi.fn() }))
vi.mock('@/actions/concepts', () => ({ setConceptLike: vi.fn() }))
vi.mock('@/actions/recolor', () => ({ resetRecolor: vi.fn(), saveRecolor: vi.fn() }))
vi.mock('@/actions/shopping', () => ({ addItem: vi.fn() }))
vi.mock('@/components/concepts/swatch-picker', () => ({ SwatchPicker: () => null }))
vi.mock('@/lib/recolor/client', () => ({ applySwatch: vi.fn(), prepareRecolor: vi.fn() }))

import { ConceptViewer } from './concept-viewer'

const match: MatchView = {
  id: 'unknown-size',
  title: 'Диван из каталога',
  brand: null,
  source: 'askona',
  priceKopecks: 50_000_00,
  oldPriceKopecks: null,
  affiliateUrl: 'https://example.com/product',
  adDisclosure: null,
  imageUrl: null,
  imageFallbackUrl: null,
  variants: [],
  similarity: 0.9,
  overBudget: false,
  dimensionsCm: null,
  fit: { state: 'unknown', reason: 'itemDimensions' },
}

const data: ConceptPageData = {
  role: 'owner',
  other: null,
  concept: {
    id: 'concept',
    status: 'ready',
    objectsStatus: 'ready',
    objectsError: null,
    liked: null,
    renderSrc: '/concept.jpg',
    renderKey: 'concept.jpg',
    editedRenderKey: null,
    note: null,
    qualityReview: null,
    orderIndex: 0,
    batchId: 'batch',
  },
  room: {
    id: 'room',
    name: 'Гостиная',
    projectId: 'project',
    projectTitle: 'Квартира',
    budgetKopecks: null,
  },
  plan: null,
  shopping: { byCatalogItem: {}, count: 0 },
  objects: [
    {
      id: 'sofa',
      orderIndex: 0,
      category: 'sofa',
      label: 'a sofa',
      bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
      maskSrc: null,
      maskKey: null,
      swatchId: null,
      confidence: 0.9,
      window: null,
      styleOnly: false,
      matches: [
        match,
        {
          ...match,
          id: 'too-wide',
          fit: {
            state: 'tooWide',
            itemCm: 250,
            overCm: 50,
            spot: { name: 'простенок', widthCm: 200 },
          },
        },
      ],
    },
  ],
}

describe('concept and product explanations', () => {
  it('explains the purpose of the concept before the image and purchase controls', () => {
    const html = renderToStaticMarkup(createElement(ConceptViewer, { data }))
    const explanation = html.indexOf('Это визуальный концепт')
    expect(explanation).toBeGreaterThan(-1)
    expect(explanation).toBeLessThan(html.indexOf('alt="Концепт комнаты"'))
    expect(explanation).toBeLessThan(html.indexOf('Добавить в список'))
  })

  it('does not call a filter of excessive sizes a filter of verified fitting products', () => {
    const html = renderToStaticMarkup(createElement(ConceptViewer, { data }))
    expect(html).toContain('Скрыть товары с превышением габаритов')
    expect(html).toContain('Для проверки уточните полные размеры товара')
    expect(html).toContain('без полной проверки остаются с пояснением')
    expect(html).not.toContain('Показывать только то, что влезает')
  })

  it('keeps visual matching separate from dimensional and circulation checks', () => {
    const html = renderToStaticMarkup(createElement(ConceptViewer, { data }))
    expect(html).toContain('не являются точными копиями')
    expect(html).toContain('сравниваем габарит с длиной участка стены')
    expect(html).toContain('Проходы и рабочие зоны смотрите на 2D-схеме')
    expect(html).toContain('Не встанет: шире на 50 см')
  })
})
