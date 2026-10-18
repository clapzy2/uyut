import type { PlanReading } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/plan-page-geometry', () => ({ createPlanPageGeometryDraft: vi.fn() }))

import { PlanPageGeometryImport } from './plan-page-geometry-import'

const source = { sha256: 'a'.repeat(64), pdfPage: 3, state: 'existing' as const }
const reading: PlanReading = {
  sourcePage: 3,
  planState: 'existing',
  readAt: '2026-10-18',
  confirmedAt: '2026-10-18',
  rooms: [{ sourceNumber: 1, name: 'Прихожая', kind: 'living' }],
  pageReview: {
    version: 1,
    savedAt: '2026-10-18',
    contours: {
      source,
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: 842,
      pageHeight: 1191,
      rooms: [
        {
          roomSourceNumber: 1,
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
          ],
          dimensionEdges: [
            { wallEdgeIndex: 0, labelIndexes: [1] },
            { wallEdgeIndex: 1, labelIndexes: [2] },
          ],
        },
      ],
    },
  },
}
const geometry: NonNullable<PlanReading['geometry']> = {
  version: 1,
  source: 'manual',
  status: 'draft',
  widthCm: 300,
  heightCm: 300,
  walls: [],
  openings: [],
  rooms: [],
  warnings: [],
  pdfCalibration: {
    sourceSha256: source.sha256,
    pdfPage: source.pdfPage,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [1],
    labelIndexes: [1, 2],
    derivedOpeningIds: [],
  },
}
function render(current: PlanReading) {
  return renderToStaticMarkup(
    createElement(PlanPageGeometryImport, {
      projectId: 'project',
      sourceRevision: 'revision',
      reading: current,
    }),
  )
}

describe('обновление 2D-черновика из того же PDF', () => {
  it('показывает перенос и отдельное согласие при сохранённом черновике', () => {
    const html = render({ ...reading, geometry })
    expect(html).toContain('Обновить 2D-черновик из PDF')
    expect(html).toContain('по новой разметке того же PDF')
    expect(html).toContain('Проверить масштаб по выбранным сторонам (2)')
  })

  it('не предлагает заменить подтверждённую или чужую схему', () => {
    const calibration = geometry.pdfCalibration
    if (!calibration) throw new Error('Missing test calibration')
    expect(render({ ...reading, geometry: { ...geometry, status: 'confirmed' } })).toBe('')
    expect(
      render({
        ...reading,
        geometry: {
          ...geometry,
          pdfCalibration: { ...calibration, sourceSha256: 'b'.repeat(64) },
        },
      }),
    ).toBe('')
    expect(render({ ...reading, geometry: { ...geometry, pdfCalibration: undefined } })).toBe('')
  })
})

describe('explicit source page import choice', () => {
  const sourceContours = reading.pageReview?.contours
  if (!sourceContours) throw new Error('Missing test contours')
  const base: PlanReading = {
    ...reading,
    sourcePage: 6,
    rooms: [
      { name: 'Кухня', kind: 'kitchen', sourceNumber: 2 },
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 4 },
      { name: 'Детская', kind: 'kid', sourceNumber: 6 },
    ],
    pageReview: {
      version: 1,
      savedAt: '2026-10-18',
      contours: {
        ...sourceContours,
        source: { ...source, pdfPage: 6 },
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

  it('offers only the physical room in a mixed review and explains the source-only hold', () => {
    const value = structuredClone(base)
    const room = value.pageReview?.contours.rooms[0]
    if (!room) throw new Error('Missing source room')
    room.sourceTopology = {
      kind: 'unclassified-source-paint',
      floorId: 'source-floor-2',
      exactPointKeys: ['100/1:100/1', '200/1:100/1', '200/1:200/1'],
      holes: [],
      holeExactPointKeys: [],
    }
    const html = render(value)
    expect(html).toContain('физические границы ещё не проверены')
    expect(html).toContain('Создать 2D-черновик из PDF')
    expect(html).toContain('№ 4 · Спальня')
    expect(html).not.toContain('№ 2 · Кухня')
    expect(html).not.toContain('нужен контур по исходному листу')
  })

  it('does not offer metric import when every reviewed room is source-only', () => {
    const value = structuredClone(base)
    value.pageReview?.contours.rooms.splice(1)
    const room = value.pageReview?.contours.rooms[0]
    if (!room) throw new Error('Missing source room')
    room.sourceTopology = {
      kind: 'unclassified-source-paint',
      floorId: 'source-floor-2',
      exactPointKeys: ['100/1:100/1', '200/1:100/1', '200/1:200/1'],
      holes: [],
      holeExactPointKeys: [],
    }
    const html = render(value)
    expect(html).toContain('перенос в метрическую 2D/3D-модель пока недоступен')
    expect(html).not.toContain('Создать 2D-черновик из PDF')
  })

  it('offers a held source reimport only with a separate initially unchecked acknowledgement', () => {
    const value: PlanReading = {
      ...base,
      geometry: {
        version: 1,
        status: 'draft',
        requiresSourceReviewReimport: true,
        widthCm: 300,
        heightCm: 500,
        walls: [],
        openings: [],
        rooms: [],
        warnings: [],
      },
    }
    const html = render(value)
    expect(html).toContain('Подтверждаю обновление горизонтального черновика')
    expect(html).toContain('Обновить 2D-черновик из PDF')
    expect(html).toContain('иначе замена будет отклонена без потери данных')
    expect(html).not.toContain('checked=')
    expect(html).toContain('disabled=')
    expect(html).not.toContain('Существующий 2D-чертёж эта кнопка не заменяет')
  })

  it('offers a shared physical zone only once with both printed identities', () => {
    const value = structuredClone(base)
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
    const html = render(base)
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
    const value = structuredClone(base)
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
    { ...base, planState: 'proposed' as const },
    { ...base, confirmedAt: undefined },
    { ...base, pageReview: undefined },
    {
      ...base,
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
      ...base,
      rooms: [...base.rooms, { name: 'Другая спальня', kind: 'bedroom', sourceNumber: 4 }],
    })
    expect(html).not.toContain('№ 4')
    expect(html).toContain('№ 2')
  })
})
