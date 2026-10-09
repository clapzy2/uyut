import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { nativeReviewPacket } from '@/lib/projects/plan-native-review-packet'
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
  })
})
