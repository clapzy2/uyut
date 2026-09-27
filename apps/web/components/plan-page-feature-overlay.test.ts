import type { PlanPageContours } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { contourDraftsFromSaved } from './plan-page-contour-editor-model'
import { PlanPageFeatureOverlay } from './plan-page-feature-overlay'

describe('shared physical zone feature overlay', () => {
  it('draws each shared opening once and highlights it by the full zone identity', () => {
    const shared: PlanPageContours['rooms'][number] = {
      roomSourceNumbers: [1, 5],
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
      openings: [
        {
          id: 'door',
          kind: 'door',
          wallEdgeIndex: 0,
          start: { x: 15, y: 10 },
          end: { x: 20, y: 10 },
        },
      ],
    }
    const drafts = contourDraftsFromSaved([shared])
    const markup = renderToStaticMarkup(
      createElement(
        'svg',
        null,
        createElement(PlanPageFeatureOverlay, {
          drafts,
          roomKey: '1+5',
          target: { kind: 'opening', id: 'door' },
        }),
      ),
    )
    expect(markup.match(/<line /g)).toHaveLength(1)
    expect(markup).toContain('зона № 1 + 5')
    expect(markup).toContain('stroke-width="5"')
    const individual = renderToStaticMarkup(
      createElement(
        'svg',
        null,
        createElement(PlanPageFeatureOverlay, {
          drafts,
          roomKey: '1',
          target: { kind: 'opening', id: 'door' },
        }),
      ),
    )
    expect(individual).not.toContain('stroke-width="5"')
    expect(individual).not.toContain('С1')
  })
})
