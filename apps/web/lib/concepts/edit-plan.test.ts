import { buildEditPlan, editStepPrompt, KEEP_THE_REST, parseEditPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'

describe('parseEditPlan', () => {
  it('останавливает неоднозначную перекраску покрывала до платного планировщика', async () => {
    const plan = await buildEditPlan(
      'must-not-call-network',
      'Измени только цвет покрывала на приглушённый терракотовый. Подушки оставь прежними.',
    )
    expect(plan.steps).toEqual([])
    expect(plan.warningRu).toContain('основное покрывало')
    expect(plan.warningRu).toContain('плед у ног')
  })

  it.each([
    'Сделать покрывало терракотовым',
    'Измени цвет покрывала, подушки оставь прежними',
    'Перекрась покрывало, шкаф не меняй',
  ])('не теряет неоднозначную цель из-за соседнего запрета: %s', async (request) => {
    const plan = await buildEditPlan('must-not-call-network', request)
    expect(plan.steps).toEqual([])
    expect(plan.warningRu).toContain('Уточните')
  })

  it.each([
    'Перекрась основное покрывало в терракотовый. Плед и подушки не меняй.',
    'Перекрась покрывало на всю кровать, не плед.',
    'Перекрась плед у ног. Покрывало не меняй.',
    'Перекрась шкаф. Покрывало оставь прежним.',
    'Не перекрашивай покрывало, перекрась шкаф.',
    'Покрывало не менять, шкаф сделать зелёным.',
  ])('не блокирует конкретный предмет или запрет: %s', async (request) => {
    const plan = await buildEditPlan(undefined, request)
    expect(plan.steps).toHaveLength(1)
    expect(plan.warningRu).toBe('')
    expect(editStepPrompt(plan.steps[0]?.prompt ?? '', request)).toContain(JSON.stringify(request))
  })
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
  it('не расширяет перекраску дверец на рамку и корпус', () => {
    const request = 'Перекрась только дверцы верхнего шкафа в зелёный. Остальное сохранить.'
    const prompt = editStepPrompt('Repaint only the upper cabinet doors green', request)
    expect(prompt).toContain(JSON.stringify(request))
    expect(prompt).toContain('preserve the cabinet frame, side panels, top, handles and hinges')
    expect(prompt).toContain('unless this step explicitly includes them')
  })
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

  it.each([
    ['Repaint the wardrobe sage green', 'Перекрась только шкаф. Кровать и обе тумбы не меняй.'],
    [
      'Replace the chest with an open bookcase',
      'Замени комод слева на стеллаж. Тумбы, лампы и шкаф сохранить.',
    ],
  ])('сохраняет границу правки для другой мебели: %s', (step, request) => {
    const prompt = editStepPrompt(step, request)
    expect(prompt).toContain(JSON.stringify(request))
    expect(prompt).toContain(JSON.stringify(step))
    expect(prompt).toContain('does not authorize replacing its neighbours')
  })
})
