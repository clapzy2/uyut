import {
  buildTemplatePlan,
  type ConceptBrief,
  fixedPreamble,
  mandateSentence,
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

  it('ведущим становится сильнейшее семейство, а не первое в библиотеке', () => {
    // У владельца было поровну лайков в четырёх семействах, а все десять рендеров вышли
    // скандинавскими: сканди просто стоит первым в списке стилей.
    const scandi = styleLibrary.filter((style) => style.family === 'scandi')[0]
    const classic = styleLibrary.filter((style) => style.family === 'classic').slice(0, 2)
    if (!scandi || classic.length < 2) throw new Error('библиотека стилей неполная')
    const vector = styleVector([scandi.id, ...classic.map((style) => style.id)])
    expect(nearestStyles(vector, 1)[0]?.family).toBe('classic')
  })

  it('в ближайших стилях семейства не повторяются, пока есть другие', () => {
    const scandi = styleLibrary.filter((style) => style.family === 'scandi').slice(0, 2)
    const loft = styleLibrary.filter((style) => style.family === 'loft')[0]
    if (scandi.length < 2 || !loft) throw new Error('библиотека стилей неполная')
    const vector = styleVector([...scandi.map((style) => style.id), loft.id])
    expect(nearestStyles(vector, 2).map((style) => style.family)).toEqual(['scandi', 'loft'])
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

  it('когда стороны известны с плана, задание называет их вместо площади', () => {
    const plan = buildTemplatePlan(
      brief({ hasPhoto: false, sizeCm: { widthCm: 290, depthCm: 425, ceilingCm: 270 } }),
      5,
    )
    expect(plan.shared).toContain('2.9 metres wide and 4.3 metres deep')
    expect(plan.shared).toContain('ceiling 2.7 metres high')
    expect(plan.shared).not.toContain('square metres')
  })

  it('одной стороны мало: форму по ней не задать, возвращаемся к площади', () => {
    const plan = buildTemplatePlan(brief({ hasPhoto: false, sizeCm: { widthCm: 290 } }), 5)
    expect(plan.shared).toContain('about 18 square metres')
  })

  it('с фотографией размеры в задание не идут: комнату видно и так', () => {
    const plan = buildTemplatePlan(brief({ sizeCm: { widthCm: 290, depthCm: 425 } }), 5)
    expect(plan.shared).not.toContain('metres wide')
  })

  it('детская остаётся детской, а не превращается в гостиную', () => {
    const plan = buildTemplatePlan(brief({ roomKind: 'kid', hasPhoto: false }), 5)
    expect(plan.shared).toContain("children's room")
    expect(plan.shared).not.toContain('living room')
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

describe('режим «оставить как есть»', () => {
  const keep = brief({ condition: 'keep', notes: 'Перемести шкаф справа под окно' })

  it('не просит ни ремонта, ни переделки', () => {
    const text = fixedPreamble(keep)
    expect(text).not.toContain('Renovate')
    expect(text).not.toContain('Redesign')
    expect(text).toContain('the same cabinets, appliances and furniture')
  })

  it('в задании нет отделки и палитры: они перекрасили бы комнату', () => {
    const plan = buildTemplatePlan(keep, 5)
    expect(plan.shared).not.toContain('Finishes:')
    expect(plan.shared).not.toContain('Furniture level:')
  })

  it('вариации не диктуют новую расстановку', () => {
    const plan = buildTemplatePlan(keep, 5)
    expect(plan.variations).toHaveLength(5)
    expect(plan.variations.every((block) => block.startsWith('Make the requested change'))).toBe(
      true,
    )
  })
})

describe('mandateSentence', () => {
  it('просьба из заметок доходит до задания даже без перевода', () => {
    const text = mandateSentence(brief({ notes: 'Шкаф под окно' }))
    expect(text).toContain('Шкаф под окно')
    expect(text).toContain('overrides everything above')
  })

  it('перевод вытесняет русский текст', () => {
    const text = mandateSentence(
      brief({ notes: 'Шкаф под окно' }),
      'Move the cabinet under the window',
    )
    expect(text).toContain('Move the cabinet under the window')
    expect(text).not.toContain('Шкаф')
  })

  it('заметка и правка из чата идут вместе', () => {
    const text = mandateSentence(brief({ notes: 'Шкаф под окно', revision: 'darker walls' }))
    expect(text).toContain('Шкаф под окно; darker walls')
  })

  it('без пожеланий фразы нет', () => {
    expect(mandateSentence(brief())).toBe('')
  })

  it('просьба стоит после вариации, а не в середине задания', () => {
    const plan = buildTemplatePlan(brief({ notes: 'Шкаф под окно' }), 5)
    expect(plan.mandate).toContain('Шкаф под окно')
    expect(plan.shared).not.toContain('Шкаф под окно')
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
