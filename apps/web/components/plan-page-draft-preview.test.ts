import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanFillHints } from './plan-page-contour-editor-model'
import { draftRoomsFromFillHints, PlanPageDraftPreview } from './plan-page-draft-preview'

const square = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
  { x: 100, y: 200 },
]

function hints(): PlanFillHints {
  return {
    sourceRevision: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64),
    page: 4,
    status: 'diagnostic',
    refusalReason: null,
    truncated: false,
    candidates: [
      { id: 'native-fill-1:1', polygon: square, areaM2: null, nearbyText: [] },
      { id: 'native-fill-2:1', polygon: square, areaM2: null, nearbyText: [] },
    ],
    roomHints: [
      {
        sourceNumber: 1,
        name: 'Гостиная',
        markerLabelIds: [],
        fillIds: ['native-fill-1:1'],
        otherSameNumberLabels: 0,
      },
      { sourceNumber: 2, name: 'Кухня', markerLabelIds: [], fillIds: [], otherSameNumberLabels: 0 },
      {
        sourceNumber: 3,
        name: 'Спальня',
        markerLabelIds: [],
        fillIds: ['native-fill-1:1'],
        otherSameNumberLabels: 0,
      },
      {
        sourceNumber: 4,
        name: 'Балкон',
        markerLabelIds: [],
        fillIds: ['native-fill-2:1'],
        otherSameNumberLabels: 0,
      },
    ],
  }
}

describe('unconfirmed source-page preview', () => {
  it('shows only a unique fill assigned to one room', () => {
    expect(draftRoomsFromFillHints(hints()).map((room) => room.number)).toEqual([4])
  })

  it('never previews held source evidence', () => {
    expect(draftRoomsFromFillHints({ ...hints(), status: 'held' })).toEqual([])
    const html = renderToStaticMarkup(
      createElement(PlanPageDraftPreview, { hints: { ...hints(), status: 'held' } }),
    )
    expect(html).toContain('Черновой просмотр недоступен')
    expect(html).not.toContain('<svg')
  })

  it('does not choose between multiple fills and marks a truncated set', () => {
    const input = hints()
    const balcony = input.roomHints.find((room) => room.sourceNumber === 4)
    if (!balcony) throw new Error('Missing balcony fixture')
    balcony.fillIds = ['native-fill-1:1', 'native-fill-2:1']
    input.truncated = true
    expect(draftRoomsFromFillHints(input)).toEqual([])
    const html = renderToStaticMarkup(createElement(PlanPageDraftPreview, { hints: input }))
    expect(html).toContain('Набор исходных заливок неполный')
    expect(html).not.toContain('<svg')
  })

  it('labels the view as non-metric and exposes missing rooms', () => {
    const html = renderToStaticMarkup(createElement(PlanPageDraftPreview, { hints: hints() }))
    expect(html).toContain('Однозначные области: 1 из 4 помещений')
    expect(html).toContain('Остальные комнаты не показаны')
    expect(html).toContain('не доказанные границы пола')
    expect(html).toContain('без стен и высот')
    expect(html).not.toContain('м²')
    expect(html).not.toContain('подтверждённый контур')
  })
})
