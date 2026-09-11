import { MATCH_CONFIDENCE_THRESHOLD, MATCH_FLOOR } from '@uyut/ai'
import { describe, expect, it } from 'vitest'

describe('пороги подбора', () => {
  it('порог «похоже по стилю» выше порога молчания', () => {
    expect(MATCH_CONFIDENCE_THRESHOLD).toBeGreaterThan(MATCH_FLOOR)
  })

  it('замеренные на кухне выдумки остаются ниже порога молчания', () => {
    // Ковёр, которого нет, дал 0.28 и подобрал коврик в салон Peugeot.
    // Полка-корзина для ванной вместо кухонного шкафа дала 0.17.
    for (const phantom of [0.17, 0.19, 0.27, 0.28, 0.3, 0.41, 0.44]) {
      expect(phantom).toBeLessThan(MATCH_FLOOR)
    }
  })

  it('настоящие предметы остаются выше порога молчания', () => {
    for (const real of [0.58, 0.61, 0.64, 0.66, 0.73]) {
      expect(real).toBeGreaterThan(MATCH_FLOOR)
    }
  })
})
