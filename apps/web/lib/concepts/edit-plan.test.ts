import { editStepPrompt, KEEP_THE_REST, parseEditPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'

describe('parseEditPlan', () => {
  it('перенос разбирается на два шага', () => {
    const plan = parseEditPlan(
      '{"steps":[{"titleRu":"Убрать шкаф справа","prompt":"Remove the cabinet on the right","needsObject":false},{"titleRu":"Поставить шкаф под окном","prompt":"Place the cabinet under the window","needsObject":true}],"warningRu":""}',
    )
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps[1]?.needsObject).toBe(true)
  })

  it('невыполнимая просьба возвращает объяснение без шагов и без трат', () => {
    const plan = parseEditPlan('{"steps":[],"warningRu":"Окно перенести нельзя."}')
    expect(plan?.steps).toHaveLength(0)
    expect(plan?.warningRu).toBe('Окно перенести нельзя.')
  })

  it('мусор отбрасывается целиком', () => {
    expect(parseEditPlan('никакого json')).toBeNull()
    expect(parseEditPlan('{"steps":[]}')).toBeNull()
    expect(parseEditPlan('{"steps":[{"titleRu":"","prompt":""}]}')).toBeNull()
  })

  it('длинные цепочки режутся до четырёх шагов', () => {
    const step = '{"titleRu":"a","prompt":"b","needsObject":false}'
    const plan = parseEditPlan(`{"steps":[${Array(7).fill(step).join(',')}],"warningRu":""}`)
    expect(plan?.steps).toHaveLength(4)
  })
})

describe('ограничения отдельного шага правки', () => {
  it('не теряет запрет клиента, даже когда планировщик вернул только действие', () => {
    const request = 'Перекрась покрывало в терракотовый. Подушки и их синий цвет не меняй.'
    const prompt = editStepPrompt('Change the bedspread to terracotta', request)
    expect(prompt).toContain(JSON.stringify(request))
    expect(prompt).toContain('Change the bedspread to terracotta')
    expect(prompt).toContain('Preserve every explicitly excluded object and property')
  })

  it('передаёт исходную просьбу как данные, не как повтор всех действий цепочки', () => {
    const request =
      'Убери шкаф, затем поставь его под окном. Стол "А" не трогай.\nЦвет стола сохранить.'
    const prompt = editStepPrompt('Remove the cabinet', request)
    expect(prompt).toContain(JSON.stringify(request))
    expect(prompt).toContain('do not repeat earlier actions or perform later actions')
    expect(prompt).toContain('Execute only this current step: "Remove the cabinet"')
  })

  it('старый запуск без исходной просьбы сохраняет прежний формат', () => {
    expect(editStepPrompt('Remove the cabinet')).toBe(`Remove the cabinet ${KEEP_THE_REST}`)
    expect(editStepPrompt('Remove the cabinet', '  ')).toBe(`Remove the cabinet ${KEEP_THE_REST}`)
  })
})
