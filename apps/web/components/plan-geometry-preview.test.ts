import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanGeometryPreview } from './plan-geometry-preview'

describe('предпросмотр 2D-схемы', () => {
  it('shows confirmation blockers before opening the editor', () => {
    const geometry: PlanGeometry = {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 500,
      heightCm: 400,
      warnings: [],
      walls: [
        {
          id: 'first',
          kind: 'inner',
          start: { xCm: 50, yCm: 50 },
          end: { xCm: 150, yCm: 50 },
        },
        {
          id: 'second',
          kind: 'inner',
          start: { xCm: 350, yCm: 350 },
          end: { xCm: 450, yCm: 350 },
        },
      ],
      openings: [],
      rooms: [],
    }

    const draft = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))
    expect(draft).toContain('Уточнения перед подтверждением схемы')
    expect(draft).toContain('Часть стен не соединена с остальной схемой')

    const confirmed = renderToStaticMarkup(
      createElement(PlanGeometryPreview, { geometry: { ...geometry, status: 'confirmed' } }),
    )
    expect(confirmed).not.toContain('Уточнения перед подтверждением схемы')
  })

  it('объясняет границу пола и техническую пустоту отдельно от стен', () => {
    const geometry: PlanGeometry = {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 500,
      heightCm: 400,
      warnings: [],
      walls: [
        {
          id: 'wall',
          kind: 'outer',
          start: { xCm: 0, yCm: 0 },
          end: { xCm: 500, yCm: 0 },
        },
      ],
      openings: [],
      rooms: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
      voids: [
        {
          id: 'shaft',
          polygon: [
            { xCm: 450, yCm: 0 },
            { xCm: 500, yCm: 0 },
            { xCm: 500, yCm: 400 },
            { xCm: 450, yCm: 400 },
          ],
        },
      ],
    }

    const html = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))

    expect(html).toContain('граница пола')
    expect(html).toContain('техническая пустота')
    expect(html).toContain('1 стена · 0 проёмов · 0 контуров')
    expect(html).toContain('Граница пола, не оси наружных стен')
    expect(html).toContain('Техническая пустота shaft')
    expect(html.indexOf('stroke="var(--ink)"')).toBeLessThan(
      html.indexOf('Граница пола, не оси наружных стен'),
    )

    const confirmed = renderToStaticMarkup(
      createElement(PlanGeometryPreview, { geometry: { ...geometry, status: 'confirmed' } }),
    )
    expect(confirmed).toContain('Посмотреть объёмную схему')

    const unverifiedPdf = renderToStaticMarkup(
      createElement(PlanGeometryPreview, {
        geometry: {
          ...geometry,
          status: 'confirmed',
          pdfCalibration: {
            sourceSha256: 'source',
            pdfPage: 1,
            cmPerPoint: 1,
            origin: { x: 0, y: 0 },
            anchorRoomNumbers: [],
            labelIndexes: [],
            derivedOpeningIds: [],
          },
        },
      }),
    )
    expect(unverifiedPdf).toContain('нужны подтверждённая граница пола')
    expect(unverifiedPdf).not.toContain('Посмотреть объёмную схему')
  })
})
