import {
  buildTemplatePlan,
  type ConceptBrief,
  fixedPreamble,
  nearestStyles,
  styleLibrary,
  styleTagsFromVector,
  styleVector,
} from '@uyut/ai'
import { describe, expect, it } from 'vitest'

function brief(patch: Partial<ConceptBrief> = {}): ConceptBrief {
  const primary = styleLibrary[1]
  if (!primary) {
    throw new Error('библиотека стилей пуста')
  }
  return {
    roomKind: 'living',
    roomName: 'Гостиная',
    areaM2: 18,
    condition: 'bare',
    notes: null,
    hasPhoto: true,
    budgetKopecks: 800_000_00,
    household: null,
    primaryStyle: primary,
    secondaryStyles: [],
    families: [primary.family],
    ...patch,
  }
}

describe('styleVector', () => {
  it('нулевой вектор, пока ничего не лайкнули', () => {
    const vector = styleVector([])
    expect(vector).toHaveLength(1024)
    expect(vector.every((value) => value === 0)).toBe(true)
  })

  it('нормирует лайки и находит ведущий стиль', () => {
    const first = styleLibrary[0]?.id ?? ''
    const second = styleLibrary[1]?.id ?? ''
    const vector = styleVector([first, first, second])
    const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    expect(length).toBeCloseTo(1, 6)
    expect(nearestStyles(vector, 2).map((style) => style.id)).toEqual([first, second])
  })

  it('незнакомые идентификаторы игнорируются', () => {
    expect(styleVector(['нет-такого']).every((value) => value === 0)).toBe(true)
  })

  it('теги идут по убыванию веса семейств', () => {
    const scandi = styleLibrary.filter((style) => style.family === 'scandi').slice(0, 2)
    const loft = styleLibrary.filter((style) => style.family === 'loft').slice(0, 1)
    const vector = styleVector([...scandi, ...loft].map((style) => style.id))
    expect(styleTagsFromVector(vector)[0]).toBe('scandi')
  })
})

describe('buildTemplatePlan', () => {
  it('просит сделать ремонт, когда отделка черновая', () => {
    const plan = buildTemplatePlan(brief(), 5)
    expect(plan.source).toBe('template')
    expect(plan.shared).toContain('Renovate this unfinished room')
    expect(plan.shared).toContain('Finish the ceiling')
    expect(plan.shared).toContain('Remove the protective film')
  })

  it('не трогает ремонт, если он уже сделан', () => {
    const plan = buildTemplatePlan(brief({ condition: 'finished' }), 5)
    expect(plan.shared).toContain('Redesign and furnish this room')
    expect(plan.shared).not.toContain('Finish the ceiling')
  })

  it('без фото описывает комнату по площади', () => {
    const plan = buildTemplatePlan(brief({ hasPhoto: false }), 5)
    expect(plan.shared).toContain('about 18 square metres')
    expect(plan.shared).not.toContain('Keep the exact camera angle')
  })

  it('переносит потребности семьи в задание', () => {
    const plan = buildTemplatePlan(
      brief({ household: { adults: 2, kids: 1, pets: true, wfh: true } }),
      5,
    )
    expect(plan.shared).toContain('safe corner for a child')
    expect(plan.shared).toContain('cosy spot for a pet')
    expect(plan.shared).toContain('desk for working from home')
  })

  it('уровень мебели зависит от бюджета', () => {
    expect(buildTemplatePlan(brief({ budgetKopecks: 200_000_00 }), 1).shared).toContain(
      'mass-market',
    )
    expect(buildTemplatePlan(brief({ budgetKopecks: 2_500_000_00 }), 1).shared).toContain('premium')
  })

  it('вариаций ровно столько, сколько просят, и они разные', () => {
    const plan = buildTemplatePlan(brief(), 5)
    expect(plan.variations).toHaveLength(5)
    expect(new Set(plan.variations).size).toBe(5)
  })

  it('в задании нет людей, текста и водяных знаков', () => {
    const plan = buildTemplatePlan(brief(), 5)
    expect(plan.shared).toContain('no people')
    expect(plan.shared).toContain('no watermarks')
  })
})

describe('fixedPreamble', () => {
  it('геометрия и объём ремонта заданы нами, а не моделью', () => {
    const text = fixedPreamble(brief())
    expect(text).toContain('Keep the exact camera angle')
    expect(text).toContain('the same number of sashes')
    expect(text).toContain('Finish the ceiling')
  })

  it('в готовой комнате про потолок и плёнку не просим', () => {
    const text = fixedPreamble(brief({ condition: 'finished' }))
    expect(text).toContain('Keep the exact camera angle')
    expect(text).not.toContain('Finish the ceiling')
  })

  it('без фото рамка описывает комнату, а не редактирование', () => {
    const text = fixedPreamble(brief({ hasPhoto: false }))
    expect(text).toContain('about 18 square metres')
    expect(text).not.toContain('Keep the exact camera angle')
  })
})
