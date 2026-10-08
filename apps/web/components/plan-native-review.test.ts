import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { nativeReviewPacket } from '@/lib/projects/plan-native-review-packet'
import { NativeReviewResult, PlanNativeReview } from './plan-native-review'

describe('read-only native review presentation', () => {
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
