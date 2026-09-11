import { parseEditPlan } from '@uyut/ai'
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
