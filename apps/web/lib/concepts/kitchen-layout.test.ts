import { describe, expect, it } from 'vitest'
import { kitchenEnvelope } from '../../../../packages/ai/src/kitchen-layout'

describe('предварительная компоновка кухни', () => {
  it('кухня 208 × 260 не вмещает два ряда с рабочим проходом', () => {
    expect(kitchenEnvelope({ widthCm: 208, depthCm: 260 })).toEqual({
      singleRunClearanceCm: 148,
      opposingRunClearanceCm: 88,
      opposingRunsPossible: false,
      islandPossible: false,
    })
  })
  it('поворот плана не меняет результат', () => {
    expect(kitchenEnvelope({ widthCm: 260, depthCm: 208 })).toEqual(
      kitchenEnvelope({ widthCm: 208, depthCm: 260 }),
    )
  })
  it('не разрешает остров по одной лишь большой площади узкой кухни', () => {
    expect(kitchenEnvelope({ widthCm: 220, depthCm: 900 })?.islandPossible).toBe(false)
    expect(kitchenEnvelope({ widthCm: 390, depthCm: 400 })?.islandPossible).toBe(true)
  })
  it('без корректных размеров не выдаёт расчёт', () => {
    for (const widthCm of [undefined, 0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(kitchenEnvelope({ widthCm, depthCm: 300 })).toBeNull()
    }
  })
})
