import {
  architectureAnchoredPrompt,
  buildTemplatePlan,
  type ConceptBrief,
  createFalLlmPromptBuilder,
  fixedPreamble,
  mandateSentence,
  nearestStyles,
  roomRenderAspectRatio,
  styleLibrary,
  styleTagsFromVector,
  styleVector,
} from '@uyut/ai'
import { describe, expect, it, vi } from 'vitest'

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
  it('кухонные ограничения доходят до задания и без обмеров', () => {
    const prompt = fixedPreamble(brief({ roomKind: 'kitchen', hasPhoto: false, sizeCm: undefined }))
    expect(prompt).toContain('Room dimensions are unknown: do not add an island')
    const measured = fixedPreamble(
      brief({ roomKind: 'kitchen', hasPhoto: false, sizeCm: { widthCm: 208, depthCm: 260 } }),
    )
    expect(measured).toContain('two opposing runs leave 88 cm')
    expect(measured).toContain('Do not add opposing cabinet runs')
    for (const condition of ['bare', 'finished'] as const) {
      expect(fixedPreamble(brief({ roomKind: 'kitchen', hasPhoto: true, condition }))).toContain(
        'Room dimensions are unknown: do not add an island',
      )
    }
  })
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
  it('передаёт архитектуру во все концепты без фото, но не подменяет ею фото', () => {
    const layoutNotes = 'Два окна на нижней стене, дверь слева.'
    const plan = buildTemplatePlan(brief({ hasPhoto: false, layoutNotes }), 3)
    expect(plan.shared).toContain(layoutNotes)
    expect(plan.shared).toContain('not the camera')
    expect(plan.shared).toContain('make a checklist of every stated window, door, entrance')
    expect(plan.shared).toContain('exactly the stated number and kinds of openings')
    expect(plan.shared).toContain('merge adjacent openings into panoramic glazing')
    expect(plan.shared).toContain('Do not mirror the plan')
    expect(plan.shared).not.toContain('one ordinary apartment window')
    expect(fixedPreamble(brief({ hasPhoto: true, layoutNotes }))).not.toContain(layoutNotes)
    expect(fixedPreamble(brief({ hasPhoto: false }))).toContain(
      'illustrative layout, not a reconstruction',
    )
  })

  it('не навязывает узкой спальне кухонную расстановку', () => {
    const text = fixedPreamble(
      brief({ hasPhoto: false, roomKind: 'bedroom', sizeCm: { widthCm: 220, depthCm: 420 } }),
    )
    expect(text).not.toContain('one-wall or shallow L-shaped')
  })

  it('LLM получает размеры и архитектуру; они остаются в итоговом промпте', async () => {
    const layoutNotes = 'Окно снизу, дверь слева.'
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          status_url: 'https://queue.fal.run/status',
          response_url: 'https://queue.fal.run/result',
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        Response.json({
          output: JSON.stringify({
            style: 'Warm natural wood and matte cream finishes with compact furniture.',
            variations: ['Layout one.', 'Layout two.', 'Layout three.'],
          }),
        }),
      )
    try {
      const plan = await createFalLlmPromptBuilder('test-key').build(
        brief({
          hasPhoto: false,
          layoutNotes,
          sizeCm: { widthCm: 208, depthCm: 260 },
          roomKind: 'kitchen',
        }),
        3,
      )
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      expect(body.prompt).toContain(layoutNotes)
      expect(body.prompt).toContain('2.08 metres wide and 2.6 metres deep')
      expect(body.prompt).toContain('no island')
      expect(plan.source).toBe('claude')
      expect(plan.shared).toContain(layoutNotes)
      expect(plan.variations).toHaveLength(3)
    } finally {
      fetchMock.mockRestore()
    }
  })
  it('просит сделать ремонт, когда отделка черновая', () => {
    const plan = buildTemplatePlan(brief(), 5)
    expect(plan.source).toBe('template')
    expect(plan.shared).toContain('Renovate this unfinished room')
    expect(plan.shared).toContain('Finish the ceiling')
    expect(plan.shared).toContain('remove its protective film')
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
    expect(plan.shared).toContain('2.9 metres wide and 4.25 metres deep')
    expect(plan.shared).toContain('ceiling 2.7 metres high')
    expect(plan.shared).not.toContain('square metres')
    expect(plan.shared).toContain('hard outer-wall constraints')
    expect(plan.shared).toContain('at least 80 cm wide')
  })

  it('без фото не придумывает всем квартирам панорамное окно слева', () => {
    const plan = buildTemplatePlan(brief({ hasPhoto: false }), 3)
    expect(plan.shared).not.toContain('window on the left')
    expect(plan.shared).toContain('do not invent panoramic or floor-to-ceiling glazing')
  })

  it('для узкой комнаты запрещает остров и стол в проходе', () => {
    const plan = buildTemplatePlan(
      brief({ roomKind: 'kitchen', hasPhoto: false, sizeCm: { widthCm: 208, depthCm: 260 } }),
      3,
    )
    expect(plan.shared).toContain('This is a narrow room')
    expect(plan.shared).toContain('no central full-size dining table')
    expect(plan.shared).toContain('doors and drawers must open')
    expect(plan.shared).toContain('Never cover a stated window, radiator, ventilation opening')
    expect(plan.variations.every((variation) => !variation.includes('window wall'))).toBe(true)
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

  it('для кухни явно считает посадочные места по числу жителей', () => {
    const plan = buildTemplatePlan(
      brief({
        roomKind: 'kitchen',
        hasPhoto: false,
        sizeCm: { widthCm: 208, depthCm: 260 },
        household: { adults: 2, kids: 1, cookHome: true },
      }),
      3,
    )
    expect(plan.shared).toContain('exactly 3 usable dining seats')
    expect(plan.shared).toContain('folding, stackable or built into a wall-side table')
    expect(plan.shared).toContain('none may stand in the walking route')
  })

  it('не размножает детский уголок, рабочий стол и место питомца по каждой комнате', () => {
    const household = {
      adults: 2,
      kids: 1,
      pets: true,
      wfh: true,
      cookHome: true,
    }
    const kitchen = buildTemplatePlan(
      brief({ roomKind: 'kitchen', household, hasPhoto: false }),
      1,
    ).shared
    expect(kitchen).toContain('exactly 3 usable dining seats')
    expect(kitchen).toContain('generous worktop space')
    expect(kitchen).not.toContain('safe corner for a child')
    expect(kitchen).not.toContain('cosy spot for a pet')
    expect(kitchen).not.toContain('desk for working from home')

    const living = buildTemplatePlan(brief({ roomKind: 'living', household }), 1).shared
    expect(living).toContain('safe corner for a child')
    expect(living).toContain('cosy spot for a pet')
    expect(living).toContain('desk for working from home')
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

  it('не переносит диван из карточки стиля в кухню', () => {
    const plan = buildTemplatePlan(brief({ roomKind: 'kitchen' }), 2)
    const variations = plan.variations.join(' ')
    expect(variations).not.toContain('oatmeal linen sofa')
    expect(variations).toContain('No sofa')
    expect(variations).toContain('cabinetry')
  })

  it('в задании нет людей, текста и водяных знаков', () => {
    const plan = buildTemplatePlan(brief(), 5)
    expect(plan.shared).toContain('No people')
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
  it.each([true, false])('не навязывает дневной свет комнате без окон (фото: %s)', (hasPhoto) => {
    const plan = buildTemplatePlan(brief({ hasPhoto, layoutNotes: 'Комната без окон' }), 1)
    expect(plan.shared).toContain('artificial lighting in windowless rooms')
    expect(plan.shared).not.toContain('natural daylight')
    expect(plan.shared).not.toContain('soft daylight')
  })

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

describe('формат кадра по форме комнаты', () => {
  it('не растягивает почти квадратную маленькую кухню широким холстом', () => {
    expect(roomRenderAspectRatio({ hasPhoto: false, sizeCm: { widthCm: 215, depthCm: 240 } })).toBe(
      '4:3',
    )
  })

  it('выбирает более широкий кадр только для действительно вытянутой комнаты', () => {
    expect(roomRenderAspectRatio({ hasPhoto: false, sizeCm: { widthCm: 180, depthCm: 300 } })).toBe(
      '3:2',
    )
    expect(roomRenderAspectRatio({ hasPhoto: false, sizeCm: { widthCm: 240, depthCm: 550 } })).toBe(
      '16:9',
    )
  })

  it('при редактировании фотографии сохраняет исходный формат', () => {
    expect(roomRenderAspectRatio({ hasPhoto: true, sizeCm: { widthCm: 215, depthCm: 240 } })).toBe(
      'auto',
    )
  })
})

describe('визуальный якорь архитектуры', () => {
  it('требует сохранить ракурс, пропорции и все проёмы', () => {
    const text = architectureAnchoredPrompt('Move the sofa to the right.')
    expect(text).toContain('same camera position and framing')
    expect(text).toContain('room proportions')
    expect(text).toContain('Do not add, remove, move, resize or mirror any opening')
    expect(text).toContain('Move the sofa to the right.')
  })

  it('нормализует пробелы, не меняя просьбу', () => {
    expect(architectureAnchoredPrompt('  Keep   three seats.  ')).toContain('Keep three seats.')
  })
})
