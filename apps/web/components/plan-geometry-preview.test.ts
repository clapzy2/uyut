import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanGeometryPreview } from './plan-geometry-preview'

describe('предпросмотр 2D-схемы', () => {
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
    expect(html).toContain('Граница пола, не оси наружных стен')
    expect(html).toContain('Техническая пустота shaft')
    expect(html.indexOf('stroke="var(--ink)"')).toBeLessThan(
      html.indexOf('Граница пола, не оси наружных стен'),
    )
  })
})
