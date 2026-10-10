import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  type NativeReviewPacket,
  nativeReviewPacket,
} from '@/lib/projects/plan-native-review-packet'
import { inspectReviewedPageCoverage } from '@/lib/projects/plan-page-reviewed-coverage'
import { NativeReviewResult, PlanNativeReview, SavedReviewCoverage } from './plan-native-review'

describe('read-only native review presentation', () => {
  it('distinguishes no saved review from unavailable native data without save buttons', () => {
    const empty = renderToStaticMarkup(
      createElement(SavedReviewCoverage, { savedReview: { status: 'not-saved' } }),
    )
    const unavailable = renderToStaticMarkup(
      createElement(SavedReviewCoverage, {
        savedReview: { status: 'unavailable', reason: 'native-layer-unavailable' },
      }),
    )
    expect(empty).toContain('Ручная разметка этого листа ещё не сохранена')
    expect(unavailable).toContain('Разметка сохранена, но отчёт недоступен')
    expect(unavailable).not.toContain('<button')
  })
  it('shows partial coverage as candidate evidence, not a count of physical doors', () => {
    const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
    const polygon = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 100 },
    ]
    const coverage = inspectReviewedPageCoverage({
      source,
      reading: {
        readAt: '2026-10-09',
        sourcePage: 1,
        planState: 'existing',
        rooms: [{ sourceNumber: 1, name: 'Комната', kind: 'living' }],
      },
      contours: {
        source,
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [{ roomSourceNumber: 1, polygon }],
      },
      linework: {
        coordinateSystem: 'page-0-1000',
        pageWidth: 1000,
        pageHeight: 1000,
        paths: [
          { operationIndex: 1, subpathIndex: 0, paint: 'stroke', closed: true, points: polygon },
        ],
        skippedCurves: 0,
        clippedPaths: 0,
        unsupportedPaths: 0,
        unsupportedContexts: 0,
        truncated: false,
      },
    })
    const html = renderToStaticMarkup(
      createElement(SavedReviewCoverage, { savedReview: { status: 'checked', coverage } }),
    )
    expect(html).toContain('Результат частичный')
    expect(html).toContain('не число физических дверей')
    expect(html).toContain('Сохранённая 2D/3D не меняется')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<svg')
    const refused = renderToStaticMarkup(
      createElement(SavedReviewCoverage, {
        savedReview: {
          status: 'checked',
          coverage: { ...coverage, status: 'refused', refusalReason: 'different-plan-source' },
        },
      }),
    )
    expect(refused).toContain('не прошла перепроверку')
    expect(refused).not.toContain('Кандидаты пар дверных граней')
  })
  it('starts without fetching or displaying private source pixels', () => {
    const html = renderToStaticMarkup(
      createElement(PlanNativeReview, {
        projectId: 'project',
        pageNumber: 1,
        sourceRevision: 'c'.repeat(64),
        onConflict: () => {},
      }),
    )
    expect(html).toContain('Проверить исходный лист')
    expect(html).toContain('без платной генерации')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('explains readiness and unknown roles without accepting rooms or replacing saved geometry', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Сохранённые комнаты, мерки и 2D/3D не меняются')
    expect(html).toContain('Ни один цвет не означает подтверждённую комнату')
    expect(html).toContain('Что ещё нужно проверить')
    expect(html).toContain('blob:private-test')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('Кандидаты дверных символов')
  })
  it('draws only original cubic arcs and leaf edges, without a closing floor or threshold edge', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.doorSymbols = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-door-symbol-1:0',
          arc: {
            start: { x: 50, y: 100 },
            segments: [
              {
                control1: { x: 50, y: 72.386 },
                control2: { x: 72.386, y: 50 },
                end: { x: 100, y: 50 },
              },
            ],
          },
          leaf: { start: { x: 100, y: 100 }, end: { x: 50, y: 100 } },
          endpointResidualPixels: 0.083,
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты дверных символов: 1')
    expect(html).toContain('Это не число физических проёмов')
    expect(html).toContain('Показать исходные дуги, створки и рамки')
    expect(html).toContain('Точный проём, граница пола и свободный проход этим не подтверждаются')
    expect(html).toContain('Исходная дуга дверного символа')
    expect(html).toContain('Исходная линия створки')
    expect(html).toContain('stroke="#b45309"')
    expect(html).toContain('d="M 50 100 C 50 72.386 72.386 50 100 50"')
    expect(html).toContain('x1="100" y1="100" x2="50" y2="100"')
    expect(html.match(/<path\b/g)).toHaveLength(1)
    expect(html.match(/<line\b/g)).toHaveLength(1)
    expect(html).not.toContain('<polygon')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it.each(['draft', 'unresolved'] as const)(
    'does not invent source symbols when the %s search is empty',
    (status) => {
      const packet: NativeReviewPacket = nativeReviewPacket({
        source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
        image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
      })
      packet.doorSymbols = {
        status,
        refusalReason: status === 'unresolved' ? 'curve-commands-unavailable' : null,
        candidates: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain(
        status === 'unresolved'
          ? 'Кандидаты дверных символов: поиск не завершён'
          : 'Кандидаты дверных символов: 0',
      )
      if (status === 'unresolved') {
        expect(html).toContain('Неполный набор соответствующего поиска не показан')
        expect(html).toContain('curve-commands-unavailable')
      }
      expect(html).not.toContain('Показать исходные дуги, створки и рамки')
      expect(html).not.toContain('<path')
      expect(html).not.toContain('<line')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('draws only the supplied source frame polygon, not an inferred threshold or floor', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.openingFrames = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-opening-frame-1:0',
          polygon: [
            { x: 30, y: 40 },
            { x: 100, y: 40 },
            { x: 100, y: 50 },
            { x: 30, y: 50 },
            { x: 30, y: 40 },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты рамок проёмов: 1')
    expect(html).toContain('Вид проёма не определён')
    expect(html).toContain('Исходная рамка с примыкающими линиями')
    expect(html).toContain('points="30,40 100,40 100,50 30,50 30,40"')
    expect(html).toContain('stroke-dasharray="4 3"')
    expect(html).toContain('не добавляет порог или границу пола')
    expect(html.match(/<polygon\b/g)).toHaveLength(1)
    expect(html).not.toContain('<path')
    expect(html).not.toContain('<line')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('shows a frame-search refusal while preserving the source-only inspection', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.openingFrames = {
      status: 'unresolved',
      refusalReason: 'frame-search-budget',
      candidates: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты рамок проёмов: поиск не завершён')
    expect(html).toContain('frame-search-budget')
    expect(html).not.toContain('Показать исходные дуги, створки и рамки')
    expect(html).not.toContain('<polygon')
    expect(html).not.toContain('<path')
    expect(html).not.toContain('<line')
  })
})
