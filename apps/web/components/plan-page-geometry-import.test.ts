import type { PlanReading } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/plan-page-geometry', () => ({ createPlanPageGeometryDraft: vi.fn() }))

import { PlanPageGeometryImport } from './plan-page-geometry-import'

const reading: PlanReading = {
  readAt: '2026-09-27',
  confirmedAt: '2026-09-27',
  sourcePage: 6,
  planState: 'existing',
  rooms: [
    { name: 'Кухня', kind: 'kitchen', sourceNumber: 2 },
    { name: 'Спальня', kind: 'bedroom', sourceNumber: 4 },
    { name: 'Детская', kind: 'kid', sourceNumber: 6 },
  ],
  pageReview: {
    version: 1,
    savedAt: '2026-09-27',
    contours: {
      source: { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' },
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: 842,
      pageHeight: 1191,
      rooms: [2, 4].map((roomSourceNumber) => ({
        roomSourceNumber,
        polygon: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
        ],
      })),
    },
  },
}
const render = (value: PlanReading) =>
  renderToStaticMarkup(
    createElement(PlanPageGeometryImport, {
      projectId: 'project',
      sourceRevision: 'revision',
      reading: value,
    }),
  )

describe('explicit source page import choice', () => {
  it('offers a shared physical zone only once with both printed identities', () => {
    const value = structuredClone(reading)
    value.rooms.push(
      { name: 'Прихожая', kind: 'living', sourceNumber: 1 },
      { name: 'Коридор', kind: 'living', sourceNumber: 5 },
    )
    value.pageReview?.contours.rooms.push({
      roomSourceNumbers: [1, 5],
      polygon: [
        { x: 20, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 20 },
      ],
    })
    const html = render(value)
    expect(html).toContain('№ 1+5 · Прихожая / Коридор')
    expect(html).not.toContain('№ 1 · Прихожая')
    expect(html).not.toContain('№ 5 · Коридор')
  })
  it('offers only annotated unique rooms and starts with no implicit selection', () => {
    const html = render(reading)
    expect(html).toContain('№ 2 · Кухня')
    expect(html).toContain('№ 4 · Спальня')
    expect(html).not.toContain('Детская')
    expect(html).not.toContain('checked=')
    expect(html).toContain('Создать 2D-черновик из PDF')
    expect(html).toContain('disabled=')
    expect(html).toContain('AI-баланс не расходуется')
    expect(html).toContain('Это ещё не подтверждённая расстановка')
    expect(html).toContain('Список комнат уже сохранён')
    expect(html).toContain('листа 6 существующего состояния')
    expect(html).toContain('После переноса откройте редактор и сверьте')
    expect(html).toContain('Выберите хотя бы одну размеченную комнату')
    expect(html).toContain('Существующий 2D-чертёж эта кнопка не заменяет')
  })

  it('keeps advanced scale checks optional and distinct from measurement confirmation', () => {
    const value = structuredClone(reading)
    const contour = value.pageReview?.contours.rooms[0]
    if (!contour) throw new Error('Missing test contour')
    contour.dimensionEdges = [
      { wallEdgeIndex: 0, labelIndexes: [0] },
      { wallEdgeIndex: 1, labelIndexes: [1] },
    ]
    const html = render(value)
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Дополнительная проверка масштаба/)
    expect(html).toContain('а не подтверждают натурный обмер')
    expect(html).toContain('Проверить масштаб по выбранным сторонам (2)')
    expect(html).not.toContain('open=""')
  })

  it.each([
    { ...reading, planState: 'proposed' as const },
    { ...reading, confirmedAt: undefined },
    { ...reading, pageReview: undefined },
    {
      ...reading,
      geometry: {
        version: 1 as const,
        status: 'draft' as const,
        widthCm: 300,
        heightCm: 400,
        walls: [],
        openings: [],
        rooms: [],
        warnings: [],
      },
    },
  ])('does not offer import when its prerequisites are absent', (value) => {
    expect(render(value)).toBe('')
  })

  it('excludes duplicated printed room identities', () => {
    const html = render({
      ...reading,
      rooms: [...reading.rooms, { name: 'Другая спальня', kind: 'bedroom', sourceNumber: 4 }],
    })
    expect(html).not.toContain('№ 4')
    expect(html).toContain('№ 2')
  })
})
