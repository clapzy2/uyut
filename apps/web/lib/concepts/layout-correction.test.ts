import { isLayoutCorrectionImprovement, layoutCorrectionPrompt } from '@uyut/ai'
import type { ConceptQualityReview } from '@uyut/db'
import { describe, expect, it } from 'vitest'

const review = (
  issues: ConceptQualityReview['issues'],
  status: ConceptQualityReview['status'] = issues.length ? 'review' : 'checked',
): ConceptQualityReview => ({
  version: 1,
  status,
  model: 'test',
  checkedAt: '2026-09-17T00:00:00.000Z',
  issues,
  description: 'Комната.',
})

const missing = {
  code: 'requirement_unconfirmed' as const,
  detail: 'Не подтверждено: полноразмерный шкаф не виден.',
  confidence: 0.9,
}

describe('точечная коррекция рендера по 2D-контракту', () => {
  it('исправляет только единственное неподтверждённое требование', () => {
    const prompt = layoutCorrectionPrompt(
      review([missing]),
      'wardrobe: full-height storage against the right wall',
    )

    expect(prompt).toContain('full-height storage')
    expect(prompt).toContain('полноразмерный шкаф')
    expect(prompt).toContain('low sideboard')
    expect(prompt).toContain('continuous walking route')
    expect(prompt).toContain('Keep exactly the same camera')
    expect(prompt).not.toContain('near the ceiling')
    expect(prompt).toContain('Preserve every stated furniture height')
  })

  it('не тратит попытку на смешанные или отсутствующие замечания', () => {
    expect(layoutCorrectionPrompt(review([]), 'contract')).toBeNull()
    expect(layoutCorrectionPrompt(review([missing]), null)).toBeNull()
    expect(
      layoutCorrectionPrompt(
        review([missing, { code: 'blocked_access', detail: 'Вход перекрыт.', confidence: 0.9 }]),
        'contract',
      ),
    ).toBeNull()
  })

  it.each(['height 190 cm', 'height unknown'])(
    'сохраняет исходную высоту %s несмотря на формулировку проверяющего',
    (height) => {
      const contract = `Wardrobe: 60 by 50 cm footprint, ${height}, against right wall`
      const prompt = layoutCorrectionPrompt(review([missing]), contract)
      expect(prompt).toContain(contract)
      expect(prompt).toContain('Do not extend furniture to the ceiling')
      expect(prompt).not.toContain('near the ceiling')
    },
  )

  it('принимает только исправление без новых замечаний', () => {
    const before = review([missing])
    expect(isLayoutCorrectionImprovement(before, review([]))).toBe(true)
    expect(
      isLayoutCorrectionImprovement(
        before,
        review([{ code: 'opening_conflict', detail: 'Пропало окно.', confidence: 0.9 }]),
      ),
    ).toBe(false)
    expect(isLayoutCorrectionImprovement(before, review([], 'unavailable'))).toBe(false)
  })
})
